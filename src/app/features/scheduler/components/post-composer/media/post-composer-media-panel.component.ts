import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ComposerMediaService } from '../../../services/composer-media.service';
import { extractErrorMessage } from '../../../../../shared/utils/error.utils';

export type MediaPanelTab = 'device' | 'library' | 'drive' | 'canva' | 'url';

export interface MediaAppliedPayload {
  imageUrl?: string;
  mediaId?: number | null;
  selections?: { composerMediaId: number; mimeType: string; publicUrl?: string; name?: string }[];
}

@Component({
  selector: 'app-post-composer-media-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './post-composer-media-panel.component.html',
  styleUrl: './post-composer-media-panel.component.scss'
})
export class PostComposerMediaPanelComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) open = false;
  @Output() openChange = new EventEmitter<boolean>();
  @Input() initialTab: MediaPanelTab = 'device';
  /** Archivo arrastrado al editor: al abrir el panel se muestra en pestaña Ordenador. */
  @Input() pendingFile: File | null = null;
  @Input() multiSelect = false;
  @Input() maxItems = 10;
  @Input() selectedMediaIds: number[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() mediaApplied = new EventEmitter<MediaAppliedPayload>();

  activeTab: MediaPanelTab = 'device';

  /** Pestaña Ordenador */
  devicePreviewUrl: string | null = null;
  selectedDeviceFile: File | null = null;
  deviceUploading = false;
  deviceError = '';

  /** Pestaña URL */
  urlDraft = '';
  urlPreviewLoading = false;
  urlPreviewError = '';
  urlPreviewImageSrc: string | null = null;
  urlPreviewIsVideo = false;
  urlServerThumb: string | null = null;
  private urlObjectRevoke: string | null = null;

  /** Biblioteca */
  libraryLoading = false;
  libraryError = '';
  libraryItems: { id: number; thumb?: string; name?: string; mimeType?: string }[] = [];
  pendingSelections: { composerMediaId: number; mimeType: string; publicUrl?: string; name?: string }[] = [];

  private subs = new Subscription();

  readonly tabs: { id: MediaPanelTab; label: string }[] = [
    { id: 'device', label: 'Ordenador' },
    { id: 'library', label: 'Biblioteca' },
    { id: 'drive', label: 'Drive' },
    { id: 'canva', label: 'Canva' },
    { id: 'url', label: 'URL' }
  ];

  constructor(private composerMedia: ComposerMediaService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.activeTab = this.initialTab;
      this.resetUrlPreviewState();
      this.deviceError = '';
      if (this.pendingFile) {
        this.setDeviceFile(this.pendingFile);
      } else {
        this.revokeDevicePreview();
      }
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.revokeDevicePreview();
    this.revokeUrlPreview();
  }

  setTab(tab: MediaPanelTab): void {
    this.activeTab = tab;
    this.deviceError = '';
    this.libraryError = '';
    if (tab === 'library') {
      this.tryLoadLibrary();
    }
  }

  private resetUrlPreviewState(): void {
    this.urlPreviewError = '';
    this.urlPreviewImageSrc = null;
    this.urlPreviewIsVideo = false;
    this.urlServerThumb = null;
    this.revokeUrlPreview();
  }

  private revokeDevicePreview(): void {
    if (this.devicePreviewUrl) {
      URL.revokeObjectURL(this.devicePreviewUrl);
      this.devicePreviewUrl = null;
    }
    this.selectedDeviceFile = null;
  }

  private revokeUrlPreview(): void {
    if (this.urlObjectRevoke) {
      URL.revokeObjectURL(this.urlObjectRevoke);
      this.urlObjectRevoke = null;
    }
  }

  setDeviceFile(file: File | null): void {
    this.revokeDevicePreview();
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      this.deviceError = 'Formato no admitido. Usa imagen o video.';
      return;
    }
    this.selectedDeviceFile = file;
    this.devicePreviewUrl = URL.createObjectURL(file);
    this.deviceError = '';
  }

  onDeviceFileInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file) {
      this.setDeviceFile(file);
    }
    input.value = '';
  }

  onDeviceDrop(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const file = ev.dataTransfer?.files?.[0];
    if (file) {
      this.setDeviceFile(file);
    }
  }

  onDeviceDragOver(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
  }

  useDeviceUpload(): void {
    if (!this.selectedDeviceFile) {
      this.deviceError = 'Selecciona un archivo.';
      return;
    }
    this.deviceUploading = true;
    this.deviceError = '';
    const sub = this.composerMedia.uploadMedia(this.selectedDeviceFile).subscribe({
      next: (res) => {
        this.deviceUploading = false;
        const item = res.data.results?.[0];
        if (!item?.ok || !item.data) {
          this.deviceError = item?.message?.trim() || 'No se pudo subir el archivo.';
          return;
        }
        const d = item.data;
        const payload: MediaAppliedPayload = {
          mediaId: d.mediaId,
          imageUrl: d.publicUrl?.trim() || undefined,
          selections: [{
            composerMediaId: d.mediaId,
            mimeType: d.mimeType || this.selectedDeviceFile?.type || 'application/octet-stream',
            publicUrl: d.publicUrl,
            name: this.selectedDeviceFile?.name
          }]
        };
        if (this.multiSelect) {
          this.addPendingSelection(payload.selections![0]);
          this.revokeDevicePreview();
        } else {
          this.emitApplyAndClose(payload);
        }
      },
      error: (err) => {
        this.deviceUploading = false;
        this.deviceError = this.mapUploadError(err);
      }
    });
    this.subs.add(sub);
  }

  private mapUploadError(err: unknown): string {
    const http = err as HttpErrorResponse;
    const code = String((http?.error as { code?: string } | null)?.code ?? '').toUpperCase();
    if (http?.status === 413 || code === 'MEDIA_TOO_LARGE') {
      return 'El archivo supera el tamaño máximo permitido.';
    }
    if (http?.status === 415 || code === 'MEDIA_INVALID_TYPE') {
      return 'Tipo de archivo no permitido.';
    }
    if (http?.status === 403 || code === 'MEDIA_QUOTA_EXCEEDED') {
      return 'No hay espacio disponible en tu cuota de almacenamiento.';
    }
    if (http?.status === 400) {
      return extractErrorMessage(http, 'Archivo inválido. Verifica formato y contenido.');
    }
    return extractErrorMessage(http, 'No se pudo subir el archivo. Revisa tipo, tamaño permitido o cuota de almacenamiento.');
  }

  /** Previsualizar URL en cliente (sin proxy). Opcionalmente intenta preview en servidor. */
  previewUrlClient(): void {
    const url = this.urlDraft.trim();
    this.resetUrlPreviewState();
    if (!url) {
      this.urlPreviewError = 'Pega una URL.';
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.urlPreviewError = 'La URL debe comenzar por http:// o https://';
      return;
    }
    this.urlPreviewLoading = true;
    const sub = this.composerMedia.previewUrl({ url }).subscribe({
      next: (res) => {
        this.urlPreviewLoading = false;
        const d = res.data;
        if (d && d.ok === false) {
          this.urlPreviewError = 'El servidor no pudo validar la URL. Prueba «Vista previa en navegador».';
          this.fallbackClientPreview(url);
          return;
        }
        if (!d) {
          this.fallbackClientPreview(url);
          return;
        }
        this.urlPreviewIsVideo = d.type === 'video';
        this.urlServerThumb = d.thumbnailUrl || null;
        if (d.type === 'video') {
          this.urlPreviewImageSrc = d.thumbnailUrl || null;
        } else {
          this.urlPreviewImageSrc = d.thumbnailUrl || d.canonicalUrl || url;
        }
        this.urlPreviewError = '';
      },
      error: () => {
        this.urlPreviewLoading = false;
        this.fallbackClientPreview(url);
      }
    });
    this.subs.add(sub);
  }

  /** Vista previa solo en el navegador (sin POST preview-url). */
  fallbackClientPreview(url: string): void {
    const lower = url.toLowerCase();
    const videoExt = ['.mp4', '.webm', '.ogg', '.mov'];
    const looksVideo = videoExt.some((e) => lower.split('?')[0].endsWith(e));
    if (looksVideo) {
      this.urlPreviewIsVideo = true;
      this.urlPreviewImageSrc = null;
    } else {
      this.urlPreviewIsVideo = false;
      this.urlPreviewImageSrc = url;
    }
    this.urlPreviewError = '';
  }

  useExternalUrl(): void {
    const url = this.urlDraft.trim();
    if (!url) {
      this.urlPreviewError = 'Pega una URL antes de confirmar.';
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.urlPreviewError = 'URL inválida.';
      return;
    }
    this.emitApplyAndClose({ imageUrl: url, mediaId: null });
  }

  useLibraryItem(id: number): void {
    const item = this.libraryItems.find((i) => i.id === id);
    const selection = {
      composerMediaId: id,
      mimeType: item?.mimeType || 'image/jpeg',
      publicUrl: item?.thumb,
      name: item?.name
    };
    if (this.multiSelect) {
      this.toggleLibrarySelection(selection);
      return;
    }
    this.emitApplyAndClose({ mediaId: id, imageUrl: undefined, selections: [selection] });
  }

  toggleLibrarySelection(selection: { composerMediaId: number; mimeType: string; publicUrl?: string; name?: string }): void {
    const idx = this.pendingSelections.findIndex((s) => s.composerMediaId === selection.composerMediaId);
    if (idx >= 0) {
      this.pendingSelections.splice(idx, 1);
      return;
    }
    this.addPendingSelection(selection);
  }

  private addPendingSelection(selection: { composerMediaId: number; mimeType: string; publicUrl?: string; name?: string }): void {
    if (this.pendingSelections.length >= this.maxItems) {
      this.libraryError = `Máximo ${this.maxItems} elementos en el carrusel.`;
      this.deviceError = this.libraryError;
      return;
    }
    if (this.pendingSelections.some((s) => s.composerMediaId === selection.composerMediaId)) {
      return;
    }
    this.libraryError = '';
    this.deviceError = '';
    this.pendingSelections.push(selection);
  }

  isLibraryItemSelected(id: number): boolean {
    return this.pendingSelections.some((s) => s.composerMediaId === id)
      || this.selectedMediaIds.includes(id);
  }

  confirmMultiSelection(): void {
    if (this.pendingSelections.length === 0) {
      this.libraryError = 'Selecciona al menos un archivo.';
      return;
    }
    this.emitApplyAndClose({ selections: [...this.pendingSelections] });
    this.pendingSelections = [];
  }

  removePendingSelection(id: number): void {
    this.pendingSelections = this.pendingSelections.filter((s) => s.composerMediaId !== id);
  }

  private tryLoadLibrary(): void {
    this.libraryLoading = true;
    this.libraryError = '';
    this.libraryItems = [];
    const sub = this.composerMedia.listMedia({ page: 1, pageSize: 24 }).subscribe({
      next: (res) => {
        this.libraryLoading = false;
        this.libraryItems = (res.data || []).map((it) => ({
          id:
            typeof it.mediaId === 'number'
              ? it.mediaId
              : typeof it.id === 'number'
                ? it.id
                : 0,
          thumb: it.thumbnailUrl || it.publicUrl,
          name: it.name || it.mimeType,
          mimeType: it.mimeType
        }));
      },
      error: (err) => {
        this.libraryLoading = false;
        this.libraryError = extractErrorMessage(
          err,
          'No se pudo cargar la biblioteca de medios. Intenta nuevamente en unos segundos.'
        );
      }
    });
    this.subs.add(sub);
  }

  private emitApplyAndClose(payload: MediaAppliedPayload): void {
    this.mediaApplied.emit(payload);
    this.closePanel();
  }

  closePanel(): void {
    this.openChange.emit(false);
    this.closed.emit();
    this.revokeDevicePreview();
    this.resetUrlPreviewState();
    this.pendingSelections = [];
  }

  onBackdropClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList.contains('media-panel-backdrop')) {
      this.closePanel();
    }
  }
}
