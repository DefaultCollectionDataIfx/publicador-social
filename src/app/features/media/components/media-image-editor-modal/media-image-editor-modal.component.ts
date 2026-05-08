import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Canvas, FabricImage, Line, Point, Rect } from 'fabric';
import { Subscription } from 'rxjs';
import {
  ComposerMediaService,
  MediaDetailDto,
  MediaEditImageCropDto,
  MediaEditImageRequestDto,
  MediaEditImageTransformDto
} from '../../../scheduler/services/composer-media.service';
import { extractErrorMessage } from '../../../../shared/utils/error.utils';
import {
  defaultMediaImageEditPreset,
  MediaImageEditPresetItem,
  MEDIA_IMAGE_EDIT_PRESETS
} from './media-image-edit-presets';

const CROP_STROKE = '#ffffff';
const DIM_FILL = 'rgba(15, 23, 42, 0.55)';
const GRID_STROKE = 'rgba(255, 255, 255, 0.28)';
const MIN_CROP_PX = 50;

function roundCropFrac(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 1e6) / 1e6;
}

@Component({
  selector: 'app-media-image-editor-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './media-image-editor-modal.component.html',
  styleUrl: './media-image-editor-modal.component.scss'
})
export class MediaImageEditorModalComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) open = false;
  @Input({ required: true }) mediaId!: number;
  @Input({ required: true }) imageUrl!: string;
  @Input() naturalWidth = 0;
  @Input() naturalHeight = 0;
  @Input() folderId: number | null = null;
  /** Nombre base del archivo (sin ruta) para sugerir outputName. */
  @Input() assetBaseName = '';
  @Input() defaultTags: string[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<MediaDetailDto>();

  @ViewChild('canvasWrap') canvasWrapRef?: ElementRef<HTMLDivElement>;
  @ViewChild('fabricCanvas') fabricCanvasRef?: ElementRef<HTMLCanvasElement>;

  readonly presetGroups = MEDIA_IMAGE_EDIT_PRESETS;

  selectedPreset: MediaImageEditPresetItem = defaultMediaImageEditPreset();
  zoomPercent = 100;
  cropDimensionsLabel = '— × — px';
  rotateDeg: 0 | 90 | 180 | 270 = 0;
  flipHorizontal = false;
  flipVertical = false;
  transformSummaryLabel = 'Sin transformaciones';
  canSave = false;

  loading = false;
  saving = false;
  errorMessage = '';

  private canvas: Canvas | null = null;
  private fabricImage: FabricImage | null = null;
  private cropRect: Rect | null = null;
  private dimRects: Rect[] = [];
  private gridLines: Line[] = [];
  private resolvedNatW = 1;
  private resolvedNatH = 1;
  private resizeObserver: ResizeObserver | null = null;
  private saveSub: Subscription | null = null;
  private movingScaleSnapshot: { scaleX: number; scaleY: number } | null = null;

  constructor(
    private composerMedia: ComposerMediaService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.errorMessage = '';
        this.zoomPercent = 100;
        this.rotateDeg = 0;
        this.flipHorizontal = false;
        this.flipVertical = false;
        this.transformSummaryLabel = 'Sin transformaciones';
        this.canSave = false;
        setTimeout(() => this.queueBootstrap(), 0);
      } else {
        this.teardownCanvas();
      }
    }
  }

  ngOnDestroy(): void {
    this.saveSub?.unsubscribe();
    this.teardownCanvas();
  }

  selectPreset(item: MediaImageEditPresetItem): void {
    this.selectedPreset = item;
    if (this.canvas && this.fabricImage && this.cropRect) {
      this.fitCropRectToPreset();
      this.clampCropToImage();
      this.syncOverlays();
      this.updateCropLabel();
      this.canvas.requestRenderAll();
    }
    this.cdr.markForCheck();
  }

  isPresetActive(item: MediaImageEditPresetItem): boolean {
    return this.selectedPreset.presetId === item.presetId;
  }

  onZoomChange(): void {
    this.applyZoom();
    this.syncOverlays();
    this.updateCropLabel();
  }

  rotateRight(): void {
    const next = ((this.rotateDeg + 90) % 360) as 0 | 90 | 180 | 270;
    this.rotateDeg = next;
    this.applyTransformAndRefitCrop();
  }

  toggleFlipHorizontal(): void {
    this.flipHorizontal = !this.flipHorizontal;
    this.applyTransformAndRefitCrop();
  }

  toggleFlipVertical(): void {
    this.flipVertical = !this.flipVertical;
    this.applyTransformAndRefitCrop();
  }

  resetTransform(): void {
    this.rotateDeg = 0;
    this.flipHorizontal = false;
    this.flipVertical = false;
    this.applyTransformAndRefitCrop();
  }

  close(): void {
    if (this.saving) {
      return;
    }
    this.closed.emit();
  }

  save(): void {
    if (!this.canvas || !this.fabricImage || !this.cropRect || this.saving || !this.canSave) {
      return;
    }

    const crop = this.buildNormalizedCrop();
    if (!crop) {
      this.errorMessage =
        `El recorte debe cubrir al menos ${MIN_CROP_PX}×${MIN_CROP_PX} píxeles en la imagen original.`;
      this.cdr.markForCheck();
      return;
    }

    const outputName = this.buildSuggestedOutputName();
    const body: MediaEditImageRequestDto = {
      mode: 'save_as_copy',
      preset: this.selectedPreset.presetId,
      output: {
        width: this.selectedPreset.outputWidth,
        height: this.selectedPreset.outputHeight,
        format: 'webp',
        quality: 85
      },
      crop,
      ...(this.isIdentityTransform() ? {} : { transform: this.buildTransformBody() }),
      ...(outputName ? { outputName } : {}),
      ...(typeof this.folderId === 'number' ? { folderId: this.folderId } : {}),
      ...(this.defaultTags?.length ? { tags: [...this.defaultTags] } : {})
    };

    this.saving = true;
    this.errorMessage = '';
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined;

    this.saveSub?.unsubscribe();
    this.saveSub = this.composerMedia.editImage(this.mediaId, body, { idempotencyKey }).subscribe({
      next: (res) => {
        this.saving = false;
        this.saved.emit(res.data);
        this.cdr.markForCheck();
      },
      error: (err: unknown) => {
        this.saving = false;
        this.errorMessage = extractErrorMessage(err as HttpErrorResponse | Error, 'No se pudo guardar la imagen editada.');
        this.cdr.markForCheck();
      }
    });
  }

  trackPresetId(_i: number, item: MediaImageEditPresetItem): string {
    return item.presetId;
  }

  private queueBootstrap(): void {
    requestAnimationFrame(() => {
      void this.bootstrapCanvas();
    });
  }

  private async bootstrapCanvas(): Promise<void> {
    const wrap = this.canvasWrapRef?.nativeElement;
    const el = this.fabricCanvasRef?.nativeElement;
    if (!wrap || !el || !this.open || !this.imageUrl) {
      return;
    }

    this.teardownCanvas();
    this.loading = true;
    this.cdr.markForCheck();

    const w = Math.max(320, wrap.clientWidth || 640);
    const h = Math.max(280, wrap.clientHeight || 420);

    this.ngZone.runOutsideAngular(() => {
      this.canvas = new Canvas(el, {
        width: w,
        height: h,
        backgroundColor: '#0f1115',
        preserveObjectStacking: true,
        stopContextMenu: true,
        uniformScaling: true
      });
    });

    this.resizeObserver = new ResizeObserver(() => this.onWrapResize());
    this.resizeObserver.observe(wrap);

    try {
      const img = await FabricImage.fromURL(this.imageUrl, {
        crossOrigin: 'anonymous'
      });

      const elImg = img.getElement();
      const nw =
        this.naturalWidth > 0 ? this.naturalWidth : (elImg as HTMLImageElement).naturalWidth || img.width || 1;
      const nh =
        this.naturalHeight > 0 ? this.naturalHeight : (elImg as HTMLImageElement).naturalHeight || img.height || 1;

      this.resolvedNatW = img.width || nw;
      this.resolvedNatH = img.height || nh;

      const pad = 24;
      const availW = w - pad * 2;
      const availH = h - pad * 2;
      const scale = Math.min(availW / this.resolvedNatW, availH / this.resolvedNatH);
      const ox = (w - this.resolvedNatW * scale) / 2;
      const oy = (h - this.resolvedNatH * scale) / 2;

      img.set({
        originX: 'center',
        originY: 'center',
        left: ox + (this.resolvedNatW * scale) / 2,
        top: oy + (this.resolvedNatH * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false
      });

      this.fabricImage = img;
      this.canvas!.add(img);
      this.applyImageTransform();

      this.buildDimRects(w, h);
      this.buildGridLines();
      this.cropRect = this.createCropRect(scale, ox, oy, this.resolvedNatW, this.resolvedNatH);
      this.canvas!.add(this.cropRect);

      this.cropRect.on('mousedown', () => {
        if (!this.cropRect) {
          return;
        }
        this.movingScaleSnapshot = {
          scaleX: this.cropRect.scaleX || 1,
          scaleY: this.cropRect.scaleY || 1
        };
      });
      this.cropRect.on('moving', () => {
        this.ngZone.run(() => {
          this.enforceMoveOnlyScale();
          this.clampCropToImage();
          this.syncOverlays();
          this.updateCropLabel();
          this.cdr.markForCheck();
        });
      });
      this.cropRect.on('scaling', () => {
        this.ngZone.run(() => {
          this.enforceCropAspect();
          this.clampCropToImage();
          this.syncOverlays();
          this.updateCropLabel();
          this.cdr.markForCheck();
        });
      });
      this.cropRect.on('modified', () => {
        this.ngZone.run(() => {
          this.enforceCropAspect();
          this.clampCropToImage();
          this.syncOverlays();
          this.updateCropLabel();
          this.movingScaleSnapshot = null;
          this.cdr.markForCheck();
        });
      });

      this.canvas!.setActiveObject(this.cropRect);
      this.applyZoom();
      this.syncOverlays();
      this.updateCropLabel();

      this.canvas!.selection = false;
    } catch {
      this.ngZone.run(() => {
        this.errorMessage =
          'No se pudo cargar la imagen en el editor (CORS o URL no válida). Prueba otra URL o revisa la configuración del almacenamiento.';
        this.loading = false;
        this.cdr.markForCheck();
      });
      this.teardownCanvas();
      return;
    }

    this.ngZone.run(() => {
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  private onWrapResize(): void {
    if (!this.canvas || !this.canvasWrapRef?.nativeElement) {
      return;
    }
    const wrap = this.canvasWrapRef.nativeElement;
    const w = Math.max(320, wrap.clientWidth || 640);
    const h = Math.max(280, wrap.clientHeight || 420);
    this.canvas.setDimensions({ width: w, height: h });
    if (this.fabricImage && this.resolvedNatW > 0 && this.resolvedNatH > 0) {
      const pad = 24;
      const availW = w - pad * 2;
      const availH = h - pad * 2;
      const scale = Math.min(availW / this.resolvedNatW, availH / this.resolvedNatH);
      const dispW = this.resolvedNatW * scale;
      const dispH = this.resolvedNatH * scale;
      const ox = (w - dispW) / 2;
      const oy = (h - dispH) / 2;
      this.fabricImage.set({
        left: ox + dispW / 2,
        top: oy + dispH / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale
      });
      this.applyImageTransform();
      this.fabricImage.setCoords();
      this.fitCropRectToPreset();
      this.clampCropToImage();
    }
    this.buildDimRects(w, h);
    this.syncOverlays();
    this.updateCropLabel();
    this.canvas.requestRenderAll();
    this.ngZone.run(() => this.cdr.markForCheck());
  }

  private createCropRect(scale: number, ox: number, oy: number, nw: number, nh: number): Rect {
    const ar = this.selectedPreset.aspectWidth / this.selectedPreset.aspectHeight;
    let cwNat: number;
    let chNat: number;
    if (nw / nh > ar) {
      chNat = nh;
      cwNat = chNat * ar;
    } else {
      cwNat = nw;
      chNat = cwNat / ar;
    }
    const cxNat = (nw - cwNat) / 2;
    const cyNat = (nh - chNat) / 2;

    const left = ox + cxNat * scale;
    const top = oy + cyNat * scale;
    const width = cwNat;
    const height = chNat;

    const rect = new Rect({
      left,
      top,
      originX: 'left',
      originY: 'top',
      width,
      height,
      scaleX: scale,
      scaleY: scale,
      fill: 'transparent',
      stroke: CROP_STROKE,
      strokeWidth: 2,
      strokeUniform: true,
      cornerColor: '#ffffff',
      cornerStyle: 'circle',
      transparentCorners: false,
      borderColor: CROP_STROKE,
      lockRotation: true,
      lockSkewingX: true,
      lockSkewingY: true,
      hasRotatingPoint: false
    });
    rect.setControlsVisibility({ mtr: false });
    return rect;
  }

  private fitCropRectToPreset(): void {
    if (!this.fabricImage || !this.cropRect) {
      return;
    }
    const imgBounds = this.fabricImage.getBoundingRect();
    const ox = imgBounds.left;
    const oy = imgBounds.top;
    const nw = imgBounds.width;
    const nh = imgBounds.height;

    const ar = this.selectedPreset.aspectWidth / this.selectedPreset.aspectHeight;
    let cwNat: number;
    let chNat: number;
    if (nw / nh > ar) {
      chNat = nh;
      cwNat = chNat * ar;
    } else {
      cwNat = nw;
      chNat = cwNat / ar;
    }
    const cxNat = (nw - cwNat) / 2;
    const cyNat = (nh - chNat) / 2;

    this.cropRect.set({
      left: ox + cxNat,
      top: oy + cyNat,
      width: cwNat,
      height: chNat,
      scaleX: 1,
      scaleY: 1,
      angle: 0
    });
    this.cropRect.setCoords();
  }

  private enforceCropAspect(): void {
    if (!this.cropRect) {
      return;
    }
    const ar = this.selectedPreset.aspectWidth / this.selectedPreset.aspectHeight;
    const sw = this.cropRect.scaleX || 1;
    const sh = this.cropRect.scaleY || 1;
    let w = (this.cropRect.width || 1) * sw;
    let h = (this.cropRect.height || 1) * sh;
    const cur = w / h;
    if (Math.abs(cur - ar) > 0.0001) {
      if (cur > ar) {
        w = h * ar;
      } else {
        h = w / ar;
      }
      const bw = this.cropRect.width || 1;
      const bh = this.cropRect.height || 1;
      this.cropRect.set({
        scaleX: w / bw,
        scaleY: h / bh
      });
    }
    this.cropRect.setCoords();
  }

  private clampCropToImage(): void {
    if (!this.fabricImage || !this.cropRect) {
      return;
    }
    const imgBounds = this.fabricImage.getBoundingRect();
    const ix = imgBounds.left;
    const iy = imgBounds.top;
    const iw = imgBounds.width;
    const ih = imgBounds.height;

    let cl = this.cropRect.left ?? 0;
    let ct = this.cropRect.top ?? 0;
    let cw = this.cropRect.getScaledWidth();
    let ch = this.cropRect.getScaledHeight();

    const ar = this.selectedPreset.aspectWidth / this.selectedPreset.aspectHeight;

    if (cw > iw) {
      cw = iw;
      ch = cw / ar;
    }
    if (ch > ih) {
      ch = ih;
      cw = ch * ar;
    }

    cl = Math.min(Math.max(cl, ix), ix + iw - cw);
    ct = Math.min(Math.max(ct, iy), iy + ih - ch);

    const bw = this.cropRect.width || 1;
    const bh = this.cropRect.height || 1;
    this.cropRect.set({
      left: cl,
      top: ct,
      scaleX: cw / bw,
      scaleY: ch / bh,
      angle: 0
    });
    this.cropRect.setCoords();
  }

  /**
   * Evita que un arrastre desde el centro cambie tamaño por selección accidental de handlers.
   */
  private enforceMoveOnlyScale(): void {
    if (!this.cropRect || !this.movingScaleSnapshot) {
      return;
    }
    this.cropRect.set({
      scaleX: this.movingScaleSnapshot.scaleX,
      scaleY: this.movingScaleSnapshot.scaleY
    });
    this.cropRect.setCoords();
  }

  private buildDimRects(canvasW: number, canvasH: number): void {
    if (!this.canvas) {
      return;
    }
    for (const r of this.dimRects) {
      this.canvas.remove(r);
    }
    this.dimRects = [
      new Rect({ left: 0, top: 0, width: canvasW, height: canvasH, fill: DIM_FILL, selectable: false, evented: false }),
      new Rect({ left: 0, top: 0, width: canvasW, height: canvasH, fill: DIM_FILL, selectable: false, evented: false }),
      new Rect({ left: 0, top: 0, width: canvasW, height: canvasH, fill: DIM_FILL, selectable: false, evented: false }),
      new Rect({ left: 0, top: 0, width: canvasW, height: canvasH, fill: DIM_FILL, selectable: false, evented: false })
    ];
    this.canvas.add(...this.dimRects);
  }

  private buildGridLines(): void {
    if (!this.canvas) {
      return;
    }
    for (const ln of this.gridLines) {
      this.canvas.remove(ln);
    }
    this.gridLines = [];
    for (let i = 0; i < 4; i++) {
      const line = new Line([0, 0, 0, 0], {
        stroke: GRID_STROKE,
        strokeWidth: 1,
        selectable: false,
        evented: false,
        excludeFromExport: true
      });
      this.gridLines.push(line);
      this.canvas.add(line);
    }
  }

  private syncOverlays(): void {
    if (!this.canvas || !this.cropRect || this.dimRects.length < 4) {
      return;
    }
    const c = this.canvas;
    const cb = this.cropRect.getBoundingRect();
    const W = c.width || 800;
    const H = c.height || 600;
    const left = cb.left;
    const top = cb.top;
    const cw = cb.width;
    const ch = cb.height;

    const [d0, d1, d2, d3] = this.dimRects;
    d0.set({ left: 0, top: 0, width: W, height: Math.max(0, top), scaleX: 1, scaleY: 1 });
    d1.set({ left: 0, top: top + ch, width: W, height: Math.max(0, H - top - ch), scaleX: 1, scaleY: 1 });
    d2.set({ left: 0, top: top, width: Math.max(0, left), height: ch, scaleX: 1, scaleY: 1 });
    d3.set({ left: left + cw, top: top, width: Math.max(0, W - left - cw), height: ch, scaleX: 1, scaleY: 1 });
    [d0, d1, d2, d3].forEach((r) => r.setCoords());

    const x1 = left + cw / 3;
    const x2 = left + (2 * cw) / 3;
    const y1 = top + ch / 3;
    const y2 = top + (2 * ch) / 3;

    const [l0, l1, l2, l3] = this.gridLines;
    l0.set({ x1: x1, y1: top, x2: x1, y2: top + ch });
    l1.set({ x1: x2, y1: top, x2: x2, y2: top + ch });
    l2.set({ x1: left, y1: y1, x2: left + cw, y2: y1 });
    l3.set({ x1: left, y1: y2, x2: left + cw, y2: y2 });
    this.gridLines.forEach((ln) => ln.setCoords());

    if (this.fabricImage) {
      c.sendObjectToBack(this.fabricImage);
    }
    this.dimRects.forEach((r) => {
      c.bringObjectForward(r);
    });
    this.gridLines.forEach((ln) => {
      c.bringObjectForward(ln);
    });
    c.bringObjectToFront(this.cropRect);
    c.requestRenderAll();
  }

  private applyZoom(): void {
    if (!this.canvas) {
      return;
    }
    const z = Math.min(3, Math.max(0.35, this.zoomPercent / 100));
    const pt = new Point(this.canvas.width / 2, this.canvas.height / 2);
    this.canvas.zoomToPoint(pt, z);
    this.canvas.requestRenderAll();
  }

  private updateCropLabel(): void {
    const crop = this.computeNormalizedFromScene();
    if (!crop) {
      this.cropDimensionsLabel = '— × — px';
      this.canSave = false;
      return;
    }
    const transformed = this.getTransformedPixelDimensions();
    const pxW = Math.round(crop.width * transformed.width);
    const pxH = Math.round(crop.height * transformed.height);
    this.cropDimensionsLabel = `${pxW} × ${pxH} px`;
    this.canSave = pxW >= MIN_CROP_PX && pxH >= MIN_CROP_PX;
  }

  /**
   * Recorte normalizado respecto a la imagen en coordenadas de escena (independiente del zoom del viewport).
   */
  private computeNormalizedFromScene(): { x: number; y: number; width: number; height: number } | null {
    if (!this.fabricImage || !this.cropRect) {
      return null;
    }
    const imgBounds = this.fabricImage.getBoundingRect();
    const crop = this.cropRect.getBoundingRect();
    const iw = imgBounds.width;
    const ih = imgBounds.height;
    if (iw <= 0 || ih <= 0) {
      return null;
    }
    const il = imgBounds.left;
    const it = imgBounds.top;
    const cl = crop.left;
    const ct = crop.top;
    const cw = crop.width;
    const ch = crop.height;
    return {
      x: (cl - il) / iw,
      y: (ct - it) / ih,
      width: cw / iw,
      height: ch / ih
    };
  }

  private buildNormalizedCrop(): MediaEditImageCropDto | null {
    const raw = this.computeNormalizedFromScene();
    if (!raw) {
      return null;
    }

    let x = roundCropFrac(raw.x);
    let y = roundCropFrac(raw.y);
    let w = roundCropFrac(raw.width);
    let h = roundCropFrac(raw.height);

    if (x + w > 1) {
      w = roundCropFrac(1 - x);
    }
    if (y + h > 1) {
      h = roundCropFrac(1 - y);
    }

    const transformed = this.getTransformedPixelDimensions();
    const pxW = w * transformed.width;
    const pxH = h * transformed.height;
    if (pxW < MIN_CROP_PX || pxH < MIN_CROP_PX) {
      return null;
    }

    return { x, y, width: w, height: h };
  }

  private buildSuggestedOutputName(): string | undefined {
    const base = (this.assetBaseName || 'imagen').replace(/\.[^./\\]+$/, '');
    const slug = base.trim().slice(0, 80) || 'imagen';
    return `${slug}-editado.webp`;
  }

  private isIdentityTransform(): boolean {
    return this.rotateDeg === 0 && !this.flipHorizontal && !this.flipVertical;
  }

  private buildTransformBody(): MediaEditImageTransformDto {
    return {
      rotateDeg: this.rotateDeg,
      flipHorizontal: this.flipHorizontal,
      flipVertical: this.flipVertical
    };
  }

  private applyImageTransform(): void {
    if (!this.fabricImage) {
      return;
    }
    this.fabricImage.set({
      angle: this.rotateDeg,
      flipX: this.flipHorizontal,
      flipY: this.flipVertical
    });
    this.fabricImage.setCoords();
  }

  private applyTransformAndRefitCrop(): void {
    if (!this.canvas || !this.fabricImage || !this.cropRect) {
      return;
    }
    this.applyImageTransform();
    this.fitCropRectToPreset();
    this.clampCropToImage();
    this.syncTransformSummaryLabel();
    this.syncOverlays();
    this.updateCropLabel();
    this.canvas.requestRenderAll();
    this.cdr.markForCheck();
  }

  private getTransformedPixelDimensions(): { width: number; height: number } {
    if (this.rotateDeg === 90 || this.rotateDeg === 270) {
      return { width: this.resolvedNatH, height: this.resolvedNatW };
    }
    return { width: this.resolvedNatW, height: this.resolvedNatH };
  }

  private syncTransformSummaryLabel(): void {
    if (this.isIdentityTransform()) {
      this.transformSummaryLabel = 'Sin transformaciones';
      return;
    }
    const parts: string[] = [`Rotación ${this.rotateDeg}°`];
    if (this.flipHorizontal) {
      parts.push('Flip H');
    }
    if (this.flipVertical) {
      parts.push('Flip V');
    }
    this.transformSummaryLabel = parts.join(' · ');
  }

  private teardownCanvas(): void {
    this.saveSub?.unsubscribe();
    this.saveSub = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.ngZone.runOutsideAngular(() => {
      try {
        this.canvas?.dispose();
      } catch {
        /* noop */
      }
    });

    this.canvas = null;
    this.fabricImage = null;
    this.cropRect = null;
    this.dimRects = [];
    this.gridLines = [];
    this.loading = false;
    this.canSave = false;
    this.movingScaleSnapshot = null;
  }
}
