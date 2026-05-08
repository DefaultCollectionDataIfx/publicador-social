import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import {
  ComposerMediaService,
  MediaLibraryItemDto,
  MediaListSortParam,
  IntegrationFileItemDto,
  IntegrationPickerTokenDto,
  MediaFolderDto,
  MediaDetailDto
} from '../../../scheduler/services/composer-media.service';
import { extractErrorMessage } from '../../../../shared/utils/error.utils';
import { MediaSelectionService } from '../../services/media-selection.service';
import { GooglePickerService, PickedGoogleFile } from '../../services/google-picker.service';
import { MediaImageEditorModalComponent } from '../media-image-editor-modal/media-image-editor-modal.component';

/** Modo UI; `smart` se envía al API como orden servidor (`recently_used`). */
type SortMode = 'smart' | MediaListSortParam;
type Provider = 'google-drive' | 'onedrive' | 'canva';
type OAuthUiState = 'disconnected' | 'connecting' | 'verifying_callback' | 'connected' | 'error';
interface DriveFileUiItem {
  fileId: string;
  name: string;
  mimeType?: string;
  thumbnailUrl?: string;
  modifiedTime?: string;
  sizeBytes?: number;
}
type DriveTypeFilter = 'all' | 'image' | 'video' | 'document' | 'other';
type DriveViewMode = 'grid' | 'list';

interface MediaAsset {
  mediaId: number;
  name: string;
  mimeType: string;
  thumbnailUrl?: string;
  previewUrl?: string | null;
  publicUrl?: string;
  folderId?: number | null;
  folderName?: string | null;
  hasThumbnail?: boolean;
  hasPreview?: boolean;
  processingStatus?: 'pending' | 'completed' | 'failed';
  width?: number | null;
  height?: number | null;
  tenantId?: number;
  createdByUserId?: number;
  createdAt?: string;
  updatedAt?: string | null;
  lastUsedAt?: string;
  usageCount?: number;
  source?: string;
  status?: 'active' | 'archived';
  isInUse?: boolean;
  tags?: string[];
  sizeBytes?: number;
}

interface MediaFolderNode extends MediaFolderDto {
  children: MediaFolderNode[];
}

type ImportModal =
  | null
  | { kind: 'url' }
  | { kind: 'integration'; provider: Provider };

/** Vista de cuadrícula: tarjetas más grandes o más compactas + pageSize alineado al backend. */
type GridDensity = 'comfortable' | 'standard' | 'compact';
type FolderMenuContext = 'tree' | 'grid';
type ToastTone = 'success' | 'error' | 'warn' | 'info';

@Component({
  selector: 'app-gestor-archivos',
  standalone: true,
  imports: [CommonModule, FormsModule, MediaImageEditorModalComponent],
  templateUrl: './gestor-archivos.component.html',
  styleUrl: './gestor-archivos.component.scss'
})
export class GestorArchivosComponent implements OnInit, OnDestroy {
  @ViewChild('importMenuAnchor') importMenuAnchor?: ElementRef<HTMLElement>;
  @ViewChild('statusFilterAnchor') statusFilterAnchor?: ElementRef<HTMLElement>;
  @ViewChild('loadMoreSentinel') loadMoreSentinel?: ElementRef<HTMLElement>;

  private static readonly GRID_DENSITY_STORAGE_KEY = 'gestor-archivos.gridDensity';
  private static readonly DEFAULT_FOLDER_COLOR_HEX = '#64748B';
  readonly folderColorPalette: string[] = [
    '#64748B',
    '#EF4444',
    '#F97316',
    '#EAB308',
    '#22C55E',
    '#14B8A6',
    '#06B6D4',
    '#3B82F6',
    '#6366F1',
    '#8B5CF6',
    '#D946EF',
    '#EC4899'
  ];

  q = '';
  sortMode: SortMode = 'smart';
  page = 1;
  pageSize = 24;
  /** Densidad de la cuadrícula (persistida en localStorage). */
  gridDensity: GridDensity = 'standard';
  totalPages = 1;
  totalCount = 0;

  assets: MediaAsset[] = [];
  loading = false;
  /** Carga de páginas adicionales (scroll infinito). */
  loadingMore = false;
  /** True si la última carga de listado (no append) falló; oculta el estado vacío genérico. */
  assetsListLoadFailed = false;
  selectedFolderId: number | null = null;
  folderTree: MediaFolderNode[] = [];
  folderLookup = new Map<number, MediaFolderNode>();
  expandedFolderIds = new Set<number>();
  foldersLoading = false;
  breadcrumbItems: MediaFolderDto[] = [];
  breadcrumbLoading = false;
  showFolderModal = false;
  folderModalMode: 'create-root' | 'create-child' | 'rename' | 'move' = 'create-root';
  folderFormName = '';
  folderFormParentId: number | null = null;
  folderFormColorHex = GestorArchivosComponent.DEFAULT_FOLDER_COLOR_HEX;
  folderModalTarget: MediaFolderNode | null = null;
  folderSaving = false;
  dragOverFolderId: number | null = null;
  draggingMediaIds = new Set<number>();
  draggingFolderId: number | null = null;
  movingMedia = false;
  movingFolder = false;

  // Modo selección (viene del compositor)
  selectionMode = false;

  // Upload
  uploading = false;
  statusFilter: 'active' | 'archived' = 'active';

  // URL import / preview
  urlDraft = '';
  urlName = '';
  urlTagsDraft = '';
  urlPreviewLoading = false;
  urlPreviewImageSrc: string | null = null;
  urlPreviewIsVideo = false;
  importingUrl = false;

  // Detalle
  detailLoading = false;
  detailAsset: MediaAsset | null = null;
  showDetail = false;
  /** Ancestros de carpeta para la ruta en «Organización» (GET folders/{id}/ancestors). */
  detailFolderAncestors: MediaFolderDto[] = [];
  /** Panel «Detalles técnicos» expandible. */
  detailTechExpanded = true;

  // Batch UI
  selectedIds = new Set<number>();
  batchMessage = '';
  batchMessageTone: ToastTone = 'info';

  // Quota
  storageLoading = false;
  /** Tras el primer GET exitoso (o error), la tarjeta deja de modo “cargando” y mantiene altura al refrescar. */
  storageSummaryReady = false;
  usedBytes = 0;
  limitBytes: number | null = null;
  isUnlimited = false;

  // Integrations
  integrationProvider: Provider = 'google-drive';
  integrationFileId = '';
  integrationImportName = '';
  integrationImportTags = '';
  importingExternal = false;
  callbackProcessed = false;
  oauthUiState: OAuthUiState = 'disconnected';
  oauthUiMessage = '';
  integrationStatusLoading = false;
  integrationConnectedAt: string | null = null;
  integrationAccountEmail: string | null = null;
  driveFiles: DriveFileUiItem[] = [];
  driveFilesLoading = false;
  driveQuery = '';
  drivePage = 1;
  drivePageSize = 12;
  driveTotalPages = 1;
  selectedDriveFile: DriveFileUiItem | null = null;
  driveTypeFilter: DriveTypeFilter = 'all';
  driveViewMode: DriveViewMode = 'grid';
  pickerLoading = false;
  showDriveFallbackList = false;
  selectedPickerFileName = '';
  selectedPickerMimeType = '';

  // Inline editors
  showEditModal = false;
  editingAsset: MediaAsset | null = null;
  editNameDraft = '';
  editTagsDraft = '';
  editSaving = false;

  showImageEditor = false;
  imageEditorMediaId = 0;
  imageEditorImageUrl = '';
  imageEditorNaturalW = 0;
  imageEditorNaturalH = 0;
  imageEditorFolderId: number | null = null;
  imageEditorBaseName = '';
  imageEditorTags: string[] = [];

  showBatchTagModal = false;
  batchTagsDraft = '';
  batchTagSaving = false;

  /** Búsqueda al escribir (sin botón Buscar). */
  private readonly searchInput$ = new Subject<string>();
  private searchDebounceSub?: Subscription;
  private toastTimeoutId: ReturnType<typeof setTimeout> | null = null;

  importMenuOpen = false;
  statusFilterMenuOpen = false;
  importModal: ImportModal = null;
  openCardMenuId: number | null = null;
  openFolderMenuId: number | null = null;
  openFolderMenuContext: FolderMenuContext | null = null;
  batchArchiving = false;
  deletingFolderId: number | null = null;

  private readonly subscriptions = new Subscription();
  private infiniteScrollObserver: IntersectionObserver | null = null;

  constructor(
    private readonly mediaApi: ComposerMediaService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly mediaSelection: MediaSelectionService,
    private readonly googlePicker: GooglePickerService,
    private readonly ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.restoreGridDensity();

    this.searchDebounceSub = this.searchInput$
      .pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => {
        this.page = 1;
        this.loadAssets();
      });

    const sub = this.route.queryParamMap.subscribe((params) => {
      this.selectionMode = params.get('mode') === 'select';
      if (this.selectionMode) {
        this.teardownInfiniteScrollObserver();
      }
      const qp = params.get('q');
      /** Scroll infinito: siempre reiniciar desde la primera página al cambiar la URL. */
      this.page = 1;
      this.q = qp ?? '';
      const status = params.get('status');
      this.statusFilter = status === 'archived' ? 'archived' : 'active';
      const folderIdParam = Number(params.get('folderId'));
      this.selectedFolderId = Number.isFinite(folderIdParam) && folderIdParam > 0 ? folderIdParam : null;
      const openImport = params.get('openImport');
      if (openImport === 'google-drive' && this.importModal?.kind !== 'integration') {
        this.openImportIntegration('google-drive', false);
        this.router.navigate([], {
          replaceUrl: true,
          queryParams: { openImport: null },
          queryParamsHandling: 'merge'
        });
      }
      this.loadAssets();
      this.loadStorageSummary();
      this.loadFolders();
      this.loadBreadcrumb();
    });
    this.subscriptions.add(sub);

    const paramsSub = this.route.paramMap.subscribe((pathParams) => {
      this.tryProcessOAuthCallback(pathParams);
    });
    this.subscriptions.add(paramsSub);
  }

  ngOnDestroy(): void {
    this.teardownInfiniteScrollObserver();
    this.searchDebounceSub?.unsubscribe();
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
    this.subscriptions.unsubscribe();
  }

  setGridDensity(density: GridDensity): void {
    if (this.gridDensity === density) {
      return;
    }
    this.applyGridDensity(density, true);
    this.page = 1;
    this.loadAssets();
  }

  private restoreGridDensity(): void {
    try {
      const raw = localStorage.getItem(GestorArchivosComponent.GRID_DENSITY_STORAGE_KEY);
      if (raw === 'comfortable' || raw === 'standard' || raw === 'compact') {
        this.applyGridDensity(raw, false);
        return;
      }
    } catch {
      /* ignore */
    }
    this.applyGridDensity('standard', false);
  }

  private applyGridDensity(density: GridDensity, persist: boolean): void {
    this.gridDensity = density;
    this.pageSize = this.pageSizeForDensity(density);
    if (persist) {
      try {
        localStorage.setItem(GestorArchivosComponent.GRID_DENSITY_STORAGE_KEY, density);
      } catch {
        /* ignore */
      }
    }
  }

  private pageSizeForDensity(density: GridDensity): number {
    switch (density) {
      case 'comfortable':
        return 18;
      case 'compact':
        return 36;
      default:
        return 24;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    const target = ev.target as Node;
    if (this.importMenuOpen && this.importMenuAnchor?.nativeElement?.contains(target)) {
      return;
    }
    this.importMenuOpen = false;
    if (this.statusFilterMenuOpen && this.statusFilterAnchor?.nativeElement?.contains(target)) {
      return;
    }
    this.statusFilterMenuOpen = false;
    if (this.openCardMenuId !== null) {
      const t = ev.target as HTMLElement;
      const inside = t?.closest?.(`[data-card-id="${this.openCardMenuId}"]`);
      if (!inside) {
        this.openCardMenuId = null;
      }
    }
    if (this.openFolderMenuId !== null) {
      const t = ev.target as HTMLElement;
      const inside = t?.closest?.(`[data-folder-id="${this.openFolderMenuId}"]`);
      if (!inside) {
        this.openFolderMenuId = null;
        this.openFolderMenuContext = null;
      }
    }
  }

  onSearchInput(): void {
    this.searchInput$.next(this.q.trim());
  }

  showToast(message: string, tone: ToastTone = 'info', durationMs?: number): void {
    const text = message.trim();
    if (!text) {
      this.clearToast();
      return;
    }
    const defaultMs =
      tone === 'error' ? 4500 : tone === 'warn' ? 3600 : tone === 'success' ? 3000 : 2800;
    const ms = durationMs ?? defaultMs;
    this.batchMessage = text;
    this.batchMessageTone = tone;
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
    }
    this.toastTimeoutId = setTimeout(() => {
      this.clearToast();
    }, ms);
  }

  clearToast(): void {
    this.batchMessage = '';
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
  }

  toggleImportMenu(): void {
    this.importMenuOpen = !this.importMenuOpen;
  }

  openImportFromUrl(): void {
    this.importMenuOpen = false;
    this.resetUrlImportForm();
    this.importModal = { kind: 'url' };
  }

  openImportIntegration(provider: Provider, autoConnectIfDisconnected = true): void {
    this.importMenuOpen = false;
    this.integrationProvider = provider;
    this.integrationFileId = '';
    this.integrationImportName = '';
    this.integrationImportTags = '';
    this.driveFiles = [];
    this.driveQuery = '';
    this.drivePage = 1;
    this.selectedDriveFile = null;
    this.driveTypeFilter = 'all';
    this.driveViewMode = 'grid';
    this.pickerLoading = false;
    this.showDriveFallbackList = false;
    this.selectedPickerFileName = '';
    this.selectedPickerMimeType = '';
    if (this.oauthUiState === 'error') {
      this.oauthUiState = 'disconnected';
      this.oauthUiMessage = '';
    }
    this.importModal = { kind: 'integration', provider };
    this.refreshIntegrationStatus(provider, false, autoConnectIfDisconnected);
  }

  closeImportModal(): void {
    this.importModal = null;
    this.selectedPickerFileName = '';
    this.selectedPickerMimeType = '';
  }

  private resetUrlImportForm(): void {
    this.urlDraft = '';
    this.urlName = '';
    this.urlTagsDraft = '';
    this.urlPreviewImageSrc = null;
    this.urlPreviewIsVideo = false;
  }

  toggleCardMenu(mediaId: number, ev: Event): void {
    ev.stopPropagation();
    this.openCardMenuId = this.openCardMenuId === mediaId ? null : mediaId;
  }

  onAssetContextMenu(ev: MouseEvent, mediaId: number): void {
    if (this.selectionMode) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.openFolderMenuId = null;
    this.openFolderMenuContext = null;
    this.openCardMenuId = mediaId;
  }

  closeCardMenu(): void {
    this.openCardMenuId = null;
  }

  toggleFolderMenu(folderId: number, context: FolderMenuContext, ev: Event): void {
    ev.stopPropagation();
    this.openCardMenuId = null;
    const isSameMenu = this.openFolderMenuId === folderId && this.openFolderMenuContext === context;
    if (isSameMenu) {
      this.openFolderMenuId = null;
      this.openFolderMenuContext = null;
      return;
    }
    this.openFolderMenuId = folderId;
    this.openFolderMenuContext = context;
  }

  onFolderContextMenu(ev: MouseEvent, folder: MediaFolderNode, context: FolderMenuContext): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.openCardMenuId = null;
    this.openFolderMenuId = folder.folderId;
    this.openFolderMenuContext = context;
  }

  isFolderMenuOpen(folderId: number, context: FolderMenuContext): boolean {
    return this.openFolderMenuId === folderId && this.openFolderMenuContext === context;
  }

  /**
   * @param append Si es true, pide la siguiente página y concatena (scroll infinito).
   */
  loadAssets(append = false): void {
    if (append) {
      if (this.loading || this.loadingMore) return;
      if (this.page >= this.totalPages) return;
      this.teardownInfiniteScrollObserver();
      this.loadingMore = true;
    } else {
      this.loading = true;
      this.assetsListLoadFailed = false;
    }

    const pageToFetch = append ? this.page + 1 : this.page;

    const sub = this.mediaApi
      .listMedia({
        page: pageToFetch,
        pageSize: this.pageSize,
        q: this.q,
        status: this.statusFilter,
        sort: this.listMediaSortParam(),
        folderId: this.selectedFolderId,
        withoutFolder: this.selectedFolderId === null
      })
      .subscribe({
        next: (res) => {
          const list = Array.isArray(res.data) ? res.data : [];
          const normalized = list.map((it) => this.normalizeAsset(it));
          const totalFromMeta = res.meta?.totalCount;
          if (typeof totalFromMeta === 'number') {
            this.totalCount = totalFromMeta;
          } else if (!append) {
            this.totalCount = normalized.length;
          }
          const metaTpRaw = res.meta?.totalPages;
          const metaTp =
            typeof metaTpRaw === 'number'
              ? metaTpRaw
              : typeof metaTpRaw === 'string'
                ? Number(metaTpRaw)
                : NaN;
          this.totalPages =
            Number.isFinite(metaTp) && metaTp > 0
              ? Math.max(1, metaTp)
              : Math.max(1, Math.ceil(this.totalCount / Math.max(1, this.pageSize)));

          if (append) {
            if (normalized.length === 0) {
              this.totalPages = this.page;
            } else {
              const seen = new Set(this.assets.map((a) => a.mediaId));
              const extra = normalized.filter((a) => !seen.has(a.mediaId));
              this.assets = [...this.assets, ...extra];
              this.page = pageToFetch;
            }
          } else {
            this.assets = normalized;
            this.page = pageToFetch;
            this.selectedIds.clear();
          }

          this.loading = false;
          this.loadingMore = false;
          this.assetsListLoadFailed = false;
          this.scheduleInfiniteScrollSetup();
        },
        error: (err) => {
          this.loading = false;
          this.loadingMore = false;
          if (!append) {
            this.assetsListLoadFailed = true;
            this.showToast(extractErrorMessage(err, 'No se pudo cargar el gestor de archivos.'), 'error');
          }
          this.scheduleInfiniteScrollSetup();
        }
      });
    this.subscriptions.add(sub);
  }

  /** Tras cambiar datos el DOM debe pintarse antes de leer #loadMoreSentinel y registrar el observer. */
  private scheduleInfiniteScrollSetup(): void {
    setTimeout(() => {
      requestAnimationFrame(() => this.setupInfiniteScrollObserver());
    }, 0);
  }

  private setupInfiniteScrollObserver(): void {
    this.teardownInfiniteScrollObserver();
    if (this.selectionMode || this.page >= this.totalPages || this.assets.length === 0) {
      return;
    }
    const el = this.loadMoreSentinel?.nativeElement;
    if (!el || el.hidden) return;
    // Viewport como root: evita desajustes si el scroll real no coincide exactamente con .main-content.
    this.infiniteScrollObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (hit) {
          this.ngZone.run(() => this.loadAssets(true));
        }
      },
      { root: null, rootMargin: '240px', threshold: 0 }
    );
    this.infiniteScrollObserver.observe(el);
  }

  private teardownInfiniteScrollObserver(): void {
    this.infiniteScrollObserver?.disconnect();
    this.infiniteScrollObserver = null;
  }

  private normalizeAsset(it: MediaLibraryItemDto | MediaDetailDto): MediaAsset {
    const anyIt = it as unknown as Record<string, unknown>;
    const mediaId =
      (typeof anyIt['mediaId'] === 'number' ? anyIt['mediaId'] : undefined) ??
      (typeof anyIt['id'] === 'number' ? anyIt['id'] : 0);
    const previewUrlRaw = anyIt['previewUrl'];
    const folderIdRaw = anyIt['folderId'];
    const widthRaw = anyIt['width'];
    const heightRaw = anyIt['height'];
    return {
      mediaId,
      name: String(anyIt['name'] ?? `Media #${mediaId}`),
      mimeType: String(anyIt['mimeType'] ?? 'application/octet-stream'),
      thumbnailUrl: typeof anyIt['thumbnailUrl'] === 'string' ? anyIt['thumbnailUrl'] : undefined,
      previewUrl: typeof previewUrlRaw === 'string' ? previewUrlRaw : null,
      publicUrl: typeof anyIt['publicUrl'] === 'string' ? anyIt['publicUrl'] : undefined,
      folderId: typeof folderIdRaw === 'number' ? folderIdRaw : folderIdRaw === null ? null : undefined,
      folderName:
        typeof anyIt['folderName'] === 'string'
          ? anyIt['folderName']
          : anyIt['folderName'] === null
            ? null
            : undefined,
      hasThumbnail: typeof anyIt['hasThumbnail'] === 'boolean' ? anyIt['hasThumbnail'] : undefined,
      hasPreview: typeof anyIt['hasPreview'] === 'boolean' ? anyIt['hasPreview'] : undefined,
      processingStatus: anyIt['processingStatus'] as MediaAsset['processingStatus'] | undefined,
      width: typeof widthRaw === 'number' ? widthRaw : widthRaw === null ? null : undefined,
      height: typeof heightRaw === 'number' ? heightRaw : heightRaw === null ? null : undefined,
      tenantId: typeof anyIt['tenantId'] === 'number' ? anyIt['tenantId'] : undefined,
      createdByUserId: typeof anyIt['createdByUserId'] === 'number' ? anyIt['createdByUserId'] : undefined,
      createdAt: typeof anyIt['createdAt'] === 'string' ? anyIt['createdAt'] : undefined,
      updatedAt: typeof anyIt['updatedAt'] === 'string' ? anyIt['updatedAt'] : null,
      lastUsedAt: typeof anyIt['lastUsedAt'] === 'string' ? anyIt['lastUsedAt'] : undefined,
      usageCount: typeof anyIt['usageCount'] === 'number' ? anyIt['usageCount'] : undefined,
      source: typeof anyIt['source'] === 'string' ? anyIt['source'] : undefined,
      status: (anyIt['status'] as MediaAsset['status']) ?? 'active',
      isInUse: typeof anyIt['isInUse'] === 'boolean' ? anyIt['isInUse'] : false,
      tags: Array.isArray(anyIt['tags']) ? (anyIt['tags'] as string[]) : [],
      sizeBytes: typeof anyIt['sizeBytes'] === 'number' ? anyIt['sizeBytes'] : undefined
    };
  }

  /**
   * Orden del listado lo define el API sobre todo el dataset (GET /api/media `sort`).
   * «Inteligente» → `recently_used` en servidor (similar al antiguo criterio por uso).
   */
  private listMediaSortParam(): MediaListSortParam {
    if (this.sortMode === 'smart') {
      return 'recently_used';
    }
    return this.sortMode;
  }

  onChangeStatus(): void {
    this.page = 1;
    this.loadAssets();
  }

  toggleStatusFilterMenu(): void {
    this.statusFilterMenuOpen = !this.statusFilterMenuOpen;
  }

  selectStatusFilter(value: 'active' | 'archived'): void {
    this.statusFilterMenuOpen = false;
    if (this.statusFilter === value) {
      return;
    }
    this.statusFilter = value;
    this.onChangeStatus();
  }

  selectFolder(folderId: number | null): void {
    this.selectedFolderId = folderId;
    this.expandFolderPath(folderId);
    this.openFolderMenuId = null;
    this.openCardMenuId = null;
    this.page = 1;
    /** URL es la única fuente de verdad: la suscripción a queryParamMap carga assets, breadcrumb y carpetas. */
    this.updateFolderQueryParam();
  }

  private updateFolderQueryParam(): void {
    this.router.navigate([], {
      replaceUrl: true,
      queryParams: { folderId: this.selectedFolderId ?? null, page: null },
      queryParamsHandling: 'merge'
    });
  }

  loadFolders(): void {
    /** Solo bloquear el panel si aún no hay árbol; al navegar se recarga en segundo plano sin ocultar la UI. */
    if (this.folderTree.length === 0) {
      this.foldersLoading = true;
    }
    const sub = this.mediaApi.listFolders().subscribe({
      next: (res) => {
        const folders = Array.isArray(res.data) ? res.data : [];
        this.rebuildFolderTree(folders);
        this.foldersLoading = false;
        if (this.selectedFolderId != null && !this.folderLookup.has(this.selectedFolderId)) {
          this.selectedFolderId = null;
          this.updateFolderQueryParam();
          this.loadAssets();
          this.breadcrumbItems = [];
          this.showToast('La carpeta seleccionada ya no existe.', 'warn');
        }
      },
      error: (err) => {
        this.foldersLoading = false;
        this.showToast(extractErrorMessage(err, 'No se pudo cargar el árbol de carpetas.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  private rebuildFolderTree(folders: MediaFolderDto[]): void {
    const nodes = new Map<number, MediaFolderNode>();
    folders.forEach((folder) => nodes.set(folder.folderId, { ...folder, children: [] }));
    const roots: MediaFolderNode[] = [];
    nodes.forEach((node) => {
      if (node.parentFolderId == null) {
        roots.push(node);
        return;
      }
      const parent = nodes.get(node.parentFolderId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortTree = (list: MediaFolderNode[]): void => {
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      list.forEach((x) => sortTree(x.children));
    };
    sortTree(roots);
    const prevExpanded = new Set(this.expandedFolderIds);
    this.folderTree = roots;
    this.folderLookup = nodes;
    const nextExpanded = new Set<number>();
    roots.forEach((r) => nextExpanded.add(r.folderId));
    prevExpanded.forEach((id) => {
      if (nodes.has(id)) nextExpanded.add(id);
    });
    this.expandedFolderIds = nextExpanded;
    this.expandFolderPath(this.selectedFolderId);
  }

  toggleFolderExpanded(folder: MediaFolderNode, ev: Event): void {
    ev.stopPropagation();
    if (!folder.children.length) return;
    if (this.expandedFolderIds.has(folder.folderId)) {
      this.expandedFolderIds.delete(folder.folderId);
    } else {
      this.expandedFolderIds.add(folder.folderId);
    }
  }

  isFolderExpanded(folder: MediaFolderNode): boolean {
    return this.expandedFolderIds.has(folder.folderId);
  }

  private expandFolderPath(folderId: number | null): void {
    if (folderId == null) return;
    let current = this.folderLookup.get(folderId);
    while (current) {
      this.expandedFolderIds.add(current.folderId);
      if (current.parentFolderId == null) break;
      current = this.folderLookup.get(current.parentFolderId);
    }
  }

  folderTreeCounter(folder: MediaFolderNode): number {
    let count = folder.children.length;
    for (const child of folder.children) {
      count += this.folderTreeCounter(child);
    }
    return count;
  }

  loadBreadcrumb(): void {
    if (this.selectedFolderId == null) {
      this.breadcrumbItems = [];
      return;
    }
    this.breadcrumbLoading = true;
    const sub = this.mediaApi.getFolderAncestors(this.selectedFolderId).subscribe({
      next: (res) => {
        this.breadcrumbLoading = false;
        this.breadcrumbItems = Array.isArray(res.data) ? res.data : [];
      },
      error: (err) => {
        this.breadcrumbLoading = false;
        const status = this.getHttpStatus(err);
        if (status === 404) {
          this.selectedFolderId = null;
          this.breadcrumbItems = [];
          this.updateFolderQueryParam();
          this.loadAssets();
          this.showToast(this.mapFolderError(err), 'warn');
          return;
        }
        this.showToast(extractErrorMessage(err, 'No se pudo cargar el breadcrumb.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  openCreateRootFolder(): void {
    this.folderModalMode = 'create-root';
    this.folderModalTarget = null;
    this.folderFormName = '';
    this.folderFormParentId = null;
    this.folderFormColorHex = GestorArchivosComponent.DEFAULT_FOLDER_COLOR_HEX;
    this.showFolderModal = true;
  }

  openCreateChildFolder(parent: MediaFolderNode): void {
    this.openFolderMenuId = null;
    this.folderModalMode = 'create-child';
    this.folderModalTarget = parent;
    this.folderFormName = '';
    this.folderFormParentId = parent.folderId;
    this.folderFormColorHex = GestorArchivosComponent.DEFAULT_FOLDER_COLOR_HEX;
    this.showFolderModal = true;
  }

  openRenameFolder(folder: MediaFolderNode): void {
    this.openFolderMenuId = null;
    this.folderModalMode = 'rename';
    this.folderModalTarget = folder;
    this.folderFormName = folder.name;
    this.folderFormParentId = folder.parentFolderId;
    this.folderFormColorHex = this.normalizeFolderColor(folder.colorHex);
    this.showFolderModal = true;
  }

  openMoveFolder(folder: MediaFolderNode): void {
    this.openFolderMenuId = null;
    this.folderModalMode = 'move';
    this.folderModalTarget = folder;
    this.folderFormName = folder.name;
    this.folderFormParentId = folder.parentFolderId;
    this.folderFormColorHex = this.normalizeFolderColor(folder.colorHex);
    this.showFolderModal = true;
  }

  closeFolderModal(): void {
    if (this.folderSaving) return;
    this.showFolderModal = false;
    this.folderModalTarget = null;
    this.folderFormName = '';
    this.folderFormParentId = null;
    this.folderFormColorHex = GestorArchivosComponent.DEFAULT_FOLDER_COLOR_HEX;
  }

  saveFolderModal(): void {
    const name = this.folderFormName.trim();
    if (!name) {
      this.showToast('El nombre de la carpeta es obligatorio.', 'warn');
      return;
    }
    const colorHex = this.normalizeFolderColor(this.folderFormColorHex);
    if (!this.isValidFolderColorHex(colorHex)) {
      this.showToast('El color debe tener formato #RRGGBB.', 'warn');
      return;
    }
    this.folderFormColorHex = colorHex;
    this.folderSaving = true;
    if (this.folderModalMode === 'create-root' || this.folderModalMode === 'create-child') {
      const sub = this.mediaApi.createFolder({
        parentFolderId: this.folderFormParentId ?? null,
        name,
        colorHex
      }).subscribe({
        next: (res) => {
          this.folderSaving = false;
          this.closeFolderModal();
          this.loadFolders();
          this.selectFolder(res.data.folderId);
          this.showToast(
            this.folderModalMode === 'create-child' ? 'Subcarpeta creada.' : 'Carpeta creada.',
            'success'
          );
        },
        error: (err) => {
          this.folderSaving = false;
          this.showToast(this.mapFolderError(err), 'error');
        }
      });
      this.subscriptions.add(sub);
      return;
    }
    if (!this.folderModalTarget) {
      this.folderSaving = false;
      return;
    }
    const sub = this.mediaApi
      .updateFolder(this.folderModalTarget.folderId, {
        parentFolderId: this.folderFormParentId ?? null,
        name,
        colorHex
      })
      .subscribe({
        next: () => {
          this.folderSaving = false;
          this.closeFolderModal();
          this.loadFolders();
          this.loadBreadcrumb();
          this.showToast(
            this.folderModalMode === 'move' ? 'Carpeta movida.' : 'Carpeta actualizada.',
            'success'
          );
        },
        error: (err) => {
          this.folderSaving = false;
          this.showToast(this.mapFolderError(err), 'error');
        }
      });
    this.subscriptions.add(sub);
  }

  deleteFolder(folder: MediaFolderNode): void {
    this.openFolderMenuId = null;
    if (!confirm(`Eliminar carpeta "${folder.name}"?`)) return;
    this.deletingFolderId = folder.folderId;
    const sub = this.mediaApi.deleteFolder(folder.folderId).subscribe({
      next: () => {
        this.deletingFolderId = null;
        this.showToast('Carpeta eliminada.', 'success');
        if (this.selectedFolderId === folder.folderId) {
          this.selectFolder(null);
        } else {
          this.loadFolders();
        }
      },
      error: (err) => {
        this.deletingFolderId = null;
        this.showToast(this.mapFolderError(err), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  folderParentOptions(excludeFolderId?: number): MediaFolderNode[] {
    return Array.from(this.folderLookup.values())
      .filter((x) => x.folderId !== excludeFolderId)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  currentFolderChildren(): MediaFolderNode[] {
    if (this.selectedFolderId == null) {
      return this.folderTree;
    }
    return this.folderLookup.get(this.selectedFolderId)?.children ?? [];
  }

  currentFolderName(): string {
    if (this.selectedFolderId == null) {
      return 'Biblioteca';
    }
    return this.folderLookup.get(this.selectedFolderId)?.name ?? 'Carpeta';
  }

  /** Ancestros para el breadcrumb (sin la carpeta actual por si el API las devuelve todas). */
  breadcrumbAncestorSegments(): MediaFolderDto[] {
    if (this.selectedFolderId == null) return [];
    return this.breadcrumbItems.filter((f) => f.folderId !== this.selectedFolderId);
  }

  canNavigateUp(): boolean {
    if (this.selectedFolderId == null) return false;
    return true;
  }

  navigateUpFolder(): void {
    if (this.selectedFolderId == null) return;
    const current = this.folderLookup.get(this.selectedFolderId);
    this.selectFolder(current?.parentFolderId ?? null);
  }

  private mapFolderError(err: unknown): string {
    const http = err as HttpErrorResponse;
    const code = String((http?.error as { code?: string } | null)?.code ?? '').toUpperCase();
    const folderErrorMessages: Record<string, string> = {
      MEDIA_FOLDER_NOT_FOUND: 'La carpeta no existe o fue eliminada.',
      MEDIA_FOLDER_PARENT_NOT_FOUND: 'La carpeta padre indicada no existe.',
      MEDIA_FOLDER_NAME_DUPLICATE: 'Ya existe una carpeta con ese nombre en el mismo nivel.',
      MEDIA_FOLDER_CYCLE: 'No puedes mover una carpeta dentro de sí misma o de sus descendientes.',
      MEDIA_FOLDER_HAS_CONTENT: 'Vacía la carpeta o mueve su contenido antes de eliminar.',
      MEDIA_FOLDER_MAX_DEPTH_EXCEEDED: 'Se alcanzó la profundidad máxima de carpetas permitida.',
      MEDIA_FOLDER_TENANT_MISMATCH: 'La carpeta no pertenece al tenant activo.'
    };
    if (folderErrorMessages[code]) return folderErrorMessages[code];
    return extractErrorMessage(http, 'No se pudo completar la operación de carpeta.');
  }

  private mapMoveMediaError(err: unknown): string {
    const http = err as HttpErrorResponse;
    const code = String((http?.error as { code?: string } | null)?.code ?? '').toUpperCase();
    const moveErrorMessages: Record<string, string> = {
      MEDIA_NOT_FOUND: 'El archivo ya no existe.',
      MEDIA_FOLDER_NOT_FOUND: 'La carpeta destino no existe.',
      MEDIA_FOLDER_TENANT_MISMATCH: 'No tienes acceso a la carpeta destino para este tenant.',
      MEDIA_TENANT_MISMATCH: 'No tienes acceso a uno o más archivos seleccionados.'
    };
    if (moveErrorMessages[code]) return moveErrorMessages[code];
    return extractErrorMessage(http, 'No se pudo mover el contenido.');
  }

  onCardDragStart(ev: DragEvent, asset: MediaAsset): void {
    if (this.selectionMode) return;
    this.draggingFolderId = null;
    const ids = this.selectedIds.has(asset.mediaId) && this.selectedIds.size > 0
      ? Array.from(this.selectedIds)
      : [asset.mediaId];
    this.draggingMediaIds = new Set(ids);
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-media-ids', JSON.stringify(ids));
      ev.dataTransfer.setData('text/plain', ids.join(','));
    }
  }

  onCardDragEnd(): void {
    this.dragOverFolderId = null;
    this.draggingMediaIds.clear();
  }

  onFolderCardDragStart(ev: DragEvent, folder: MediaFolderNode): void {
    this.draggingMediaIds.clear();
    this.draggingFolderId = folder.folderId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-folder-id', String(folder.folderId));
      ev.dataTransfer.setData('text/plain', String(folder.folderId));
    }
  }

  onFolderCardDragEnd(): void {
    this.dragOverFolderId = null;
    this.draggingFolderId = null;
  }

  onFolderDragOver(ev: DragEvent, folderId: number | null): void {
    const draggingMedia = this.draggingMediaIds.size > 0;
    const draggingFolder = this.draggingFolderId != null;
    if ((!draggingMedia && !draggingFolder) || this.movingMedia || this.movingFolder) return;
    if (draggingFolder && this.draggingFolderId != null) {
      const dragged = this.draggingFolderId;
      if (folderId === dragged) return;
      if (this.folderIsInSubtreeOf(dragged, folderId)) {
        if (ev.dataTransfer) {
          ev.dataTransfer.dropEffect = 'none';
        }
        return;
      }
    }
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'move';
    }
    this.dragOverFolderId = folderId;
  }

  onFolderDragLeave(folderId: number | null): void {
    if (this.dragOverFolderId === folderId) {
      this.dragOverFolderId = null;
    }
  }

  onFolderDrop(ev: DragEvent, folderId: number | null): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.dragOverFolderId = null;
    if (this.movingMedia || this.movingFolder) return;

    const draggedFolderId = this.draggingFolderId ?? Number(ev.dataTransfer?.getData('application/x-folder-id'));
    if (Number.isFinite(draggedFolderId) && draggedFolderId > 0) {
      if (folderId === draggedFolderId) {
        this.draggingFolderId = null;
        return;
      }
      if (folderId != null && this.folderIsInSubtreeOf(draggedFolderId, folderId)) {
        this.draggingFolderId = null;
        this.showToast('No puedes mover una carpeta dentro de sí misma ni dentro de una subcarpeta.', 'warn');
        return;
      }
      this.moveFolderToFolder(draggedFolderId, folderId);
      return;
    }

    let ids = Array.from(this.draggingMediaIds);
    if (!ids.length) {
      const raw = ev.dataTransfer?.getData('application/x-media-ids') || ev.dataTransfer?.getData('text/plain') || '';
      ids = raw
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0);
    }
    ids = Array.from(new Set(ids));
    if (!ids.length) return;
    this.moveMediaToFolder(ids, folderId);
  }

  /** Si `nodeId` es `ancestorId` o un descendiente en el árbol actual (subiendo por padres). */
  private folderIsInSubtreeOf(ancestorId: number, nodeId: number | null): boolean {
    if (nodeId == null) return false;
    let id: number | null = nodeId;
    while (id != null) {
      if (id === ancestorId) return true;
      const n = this.folderLookup.get(id);
      if (!n) return false;
      id = n.parentFolderId ?? null;
    }
    return false;
  }

  private moveFolderToFolder(folderId: number, parentFolderId: number | null): void {
    const folder = this.folderLookup.get(folderId);
    if (!folder) {
      this.draggingFolderId = null;
      return;
    }
    if (parentFolderId != null && this.folderIsInSubtreeOf(folderId, parentFolderId)) {
      this.draggingFolderId = null;
      this.showToast('No puedes mover una carpeta dentro de sí misma ni dentro de una subcarpeta.', 'warn');
      return;
    }
    this.movingFolder = true;
    this.clearToast();
    const sub = this.mediaApi
      .updateFolder(folderId, {
        parentFolderId,
        name: folder.name,
        colorHex: folder.colorHex
      })
      .subscribe({
        next: () => {
          this.movingFolder = false;
          this.draggingFolderId = null;
          this.showToast('Carpeta movida correctamente.', 'success');
          this.loadFolders();
          this.loadBreadcrumb();
        },
        error: (err) => {
          this.movingFolder = false;
          this.draggingFolderId = null;
          this.showToast(this.mapFolderError(err), 'error');
        }
      });
    this.subscriptions.add(sub);
  }

  private moveMediaToFolder(mediaIds: number[], folderId: number | null): void {
    this.movingMedia = true;
    this.clearToast();
    const done = (): void => {
      this.movingMedia = false;
      this.draggingMediaIds.clear();
      this.selectedIds.clear();
      this.loadAssets();
      this.loadFolders();
    };
    const onError = (err: unknown): void => {
      this.movingMedia = false;
      this.showToast(this.mapMoveMediaError(err), 'error');
      this.draggingMediaIds.clear();
    };
    if (mediaIds.length === 1) {
      const sub = this.mediaApi.moveMedia(mediaIds[0], { folderId }).subscribe({
        next: () => {
          this.showToast('Archivo movido correctamente.', 'success');
          done();
        },
        error: onError
      });
      this.subscriptions.add(sub);
      return;
    }
    const sub = this.mediaApi.bulkMoveMedia({ mediaIds, folderId }).subscribe({
      next: (res) => {
        const data = res.data;
        this.showToast(
          `Traslado: ${data.processed} correctos${data.failed ? `, ${data.failed} fallidos` : ''}.`,
          data.failed > 0 ? 'warn' : 'success'
        );
        done();
      },
      error: onError
    });
    this.subscriptions.add(sub);
  }

  onChangeSort(): void {
    this.page = 1;
    this.loadAssets();
  }

  onUploadInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadFile(file);
    input.value = '';
  }

  private uploadFile(file: File): void {
    this.uploading = true;
    const sub = this.mediaApi.uploadMedia(file).subscribe({
      next: (res) => {
        this.uploading = false;
        const status = res.data?.processingStatus;
        if (status === 'pending') {
          this.showToast('Archivo subido. Procesando miniatura/vista previa en segundo plano.', 'info');
        } else if (status === 'failed') {
          this.showToast('Archivo subido, pero falló el procesamiento de derivados.', 'warn');
        } else {
          this.clearToast();
        }
        this.loadAssets();
        this.loadStorageSummary();
      },
      error: (err) => {
        this.uploading = false;
        this.showToast(this.mapUploadError(err), 'error');
      }
    });
    this.subscriptions.add(sub);
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
    return extractErrorMessage(http, 'No se pudo subir el archivo.');
  }

  openDetail(asset: MediaAsset): void {
    this.closeCardMenu();
    this.showDetail = true;
    this.detailLoading = true;
    const sub = this.mediaApi.getMedia(asset.mediaId).subscribe({
      next: (res) => {
        this.detailLoading = false;
        this.detailAsset = this.normalizeAsset(res.data);
        this.loadDetailFolderAncestors(res.data.folderId);
      },
      error: (err) => {
        this.detailLoading = false;
        this.showDetail = false;
        this.showToast(extractErrorMessage(err, 'No se pudo cargar el detalle.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  closeDetail(): void {
    this.showDetail = false;
    this.detailAsset = null;
    this.detailFolderAncestors = [];
    this.detailTechExpanded = true;
  }

  private loadDetailFolderAncestors(folderId: number | null | undefined): void {
    this.detailFolderAncestors = [];
    if (folderId == null || typeof folderId !== 'number') {
      return;
    }
    const sub = this.mediaApi.getFolderAncestors(folderId).subscribe({
      next: (res) => {
        this.detailFolderAncestors = Array.isArray(res.data) ? res.data : [];
      },
      error: () => {
        this.detailFolderAncestors = [];
      }
    });
    this.subscriptions.add(sub);
  }

  toggleDetailTechSection(): void {
    this.detailTechExpanded = !this.detailTechExpanded;
  }

  /** Ruta legible tipo «Biblioteca / … / carpeta» para el bloque Organización. */
  detailLocationPathLabel(): string {
    const asset = this.detailAsset;
    if (!asset) {
      return '—';
    }
    if (asset.folderId === null) {
      return 'Biblioteca';
    }
    const parts: string[] = ['Biblioteca'];
    const byDepth = [...this.detailFolderAncestors].sort((a, b) => a.depth - b.depth);
    const seen = new Set<number>();
    for (const f of byDepth) {
      if (seen.has(f.folderId)) {
        continue;
      }
      seen.add(f.folderId);
      if (f.folderId === asset.folderId) {
        continue;
      }
      const n = f.name?.trim();
      if (n) {
        parts.push(n);
      }
    }
    const leaf = asset.folderName?.trim();
    if (leaf) {
      if (parts[parts.length - 1] !== leaf) {
        parts.push(leaf);
      }
    } else {
      parts.push('Carpeta no disponible');
    }
    return parts.join(' / ');
  }

  /** Texto principal del bloque «Uso». */
  detailUsageSummaryLine(): string {
    const asset = this.detailAsset;
    if (!asset) {
      return '';
    }
    const count = asset.usageCount ?? 0;
    if (count === 0 && !asset.isInUse && !asset.lastUsedAt?.trim()) {
      return 'No se ha usado en publicaciones todavía.';
    }
    const chunks: string[] = [];
    if (count > 0) {
      chunks.push(
        `${count} ${count === 1 ? 'referencia en planes de publicación' : 'referencias en planes de publicación'}`
      );
    }
    if (asset.isInUse) {
      chunks.push('Aparece en planes pendientes');
    }
    if (asset.lastUsedAt?.trim()) {
      chunks.push(`Último uso: ${this.formatDetailActivityDate(asset.lastUsedAt)}`);
    }
    return chunks.join(' · ') || 'Sin datos de uso.';
  }

  /** Fechas estilo «23 abr 2026, 18:27» para Actividad. */
  formatDetailActivityDate(iso?: string | null): string {
    if (!iso?.trim()) {
      return '—';
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return String(iso);
    }
    return d.toLocaleString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  detailAvailabilityWord(v: boolean | undefined): string {
    return v ? 'disponible' : 'no disponible';
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydownForDetail(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || !this.showDetail) {
      return;
    }
    ev.preventDefault();
    this.closeDetail();
  }

  /** Orden: vista previa intermedia → principal → miniatura (alineado al contrato de detalle). */
  detailPreviewImageUrl(asset: MediaAsset): string {
    const p = asset.previewUrl?.trim();
    const u = asset.publicUrl?.trim();
    const t = asset.thumbnailUrl?.trim();
    return p || u || t || '';
  }

  detailPreviewVideoUrl(asset: MediaAsset): string {
    const p = asset.previewUrl?.trim();
    const u = asset.publicUrl?.trim();
    return p || u || '';
  }

  processingStatusLabel(status?: MediaAsset['processingStatus']): string {
    switch (status) {
      case 'completed':
        return 'Procesado';
      case 'failed':
        return 'Error al procesar';
      case 'pending':
      default:
        return 'Pendiente';
    }
  }

  detailDimensionsLabel(asset: MediaAsset): string {
    const w = asset.width;
    const h = asset.height;
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
      return `${w} × ${h} px`;
    }
    return '—';
  }

  /** Texto amigable para la rejilla «Información» (p. ej. Imagen JPEG). */
  detailTypeDisplayLabel(asset: MediaAsset): string {
    const kind = this.assetBadgeLabel(asset);
    const short = this.formatMimeShort(asset.mimeType);
    if (!short || short === 'Archivo') {
      return kind;
    }
    return `${kind} ${short}`;
  }

  /** Etiqueta de fuente alineada al contrato (`upload`, importaciones, etc.). */
  detailSourceLabel(source?: string): string {
    const raw = (source ?? '').trim();
    if (!raw) {
      return '—';
    }
    const s = raw.toLowerCase();
    if (s === 'upload') {
      return 'Subida local';
    }
    if (s === 'import-url' || s === 'import_url' || s === 'import') {
      return 'Importación por URL';
    }
    return raw;
  }

  async copyDetailPublicUrl(): Promise<void> {
    const url = this.detailAsset?.publicUrl?.trim();
    if (!url) {
      this.showToast('No hay URL pública disponible.', 'warn');
      return;
    }
    await this.copyToClipboard(url, 'URL copiada al portapapeles.');
  }

  private async copyToClipboard(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(successMessage, 'success');
    } catch {
      this.showToast('No se pudo copiar al portapapeles.', 'error');
    }
  }

  openDetailEdit(): void {
    if (!this.detailAsset) {
      return;
    }
    const asset = this.detailAsset;
    this.closeDetail();
    this.editAsset(asset);
  }

  openDetailImageEditor(): void {
    const a = this.detailAsset;
    if (!a || !this.isImage(a) || a.processingStatus !== 'completed') {
      return;
    }
    const url = this.detailPreviewImageUrl(a).trim();
    if (!url) {
      this.showToast('No hay vista previa disponible para editar.', 'warn');
      return;
    }
    this.imageEditorMediaId = a.mediaId;
    this.imageEditorImageUrl = url;
    this.imageEditorNaturalW = typeof a.width === 'number' && a.width > 0 ? a.width : 0;
    this.imageEditorNaturalH = typeof a.height === 'number' && a.height > 0 ? a.height : 0;
    this.imageEditorFolderId = a.folderId ?? null;
    this.imageEditorBaseName = (a.name ?? '').trim();
    this.imageEditorTags = a.tags?.length ? [...a.tags] : [];
    this.showImageEditor = true;
  }

  closeImageEditor(): void {
    this.showImageEditor = false;
  }

  onImageEditorSaved(_detail: MediaDetailDto): void {
    this.showImageEditor = false;
    this.showToast('Nueva copia guardada en la biblioteca.', 'success');
    this.loadAssets();
  }

  openDetailUseInComposer(): void {
    if (!this.detailAsset) {
      return;
    }
    const asset = this.detailAsset;
    this.closeDetail();
    this.useInComposer(asset);
  }

  useInComposer(asset: MediaAsset): void {
    this.closeCardMenu();
    this.mediaSelection.setPendingSelection({
      mediaId: asset.mediaId,
      publicUrl: asset.publicUrl,
      thumbnailUrl: asset.thumbnailUrl,
      mimeType: asset.mimeType,
      name: asset.name
    });
    this.router.navigate(['/dashboard/programador']);
  }

  useSelectedInComposer(): void {
    const id = Array.from(this.selectedIds)[0];
    if (id == null) return;
    const asset = this.assets.find((a) => a.mediaId === id);
    if (!asset) return;
    this.useInComposer(asset);
  }

  exitSelectionMode(): void {
    this.router.navigate(['/dashboard/archivos'], {
      queryParams: { mode: null, q: this.q || null, page: null, status: this.statusFilter },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  toggleSelected(mediaId: number): void {
    if (this.selectionMode) {
      if (this.selectedIds.has(mediaId)) {
        this.selectedIds.clear();
      } else {
        this.selectedIds = new Set([mediaId]);
      }
      return;
    }
    if (this.selectedIds.has(mediaId)) {
      this.selectedIds.delete(mediaId);
    } else {
      this.selectedIds.add(mediaId);
    }
  }

  toggleSelectAllCurrentPage(): void {
    if (this.selectedIds.size === this.assets.length) {
      this.selectedIds.clear();
      return;
    }
    this.selectedIds = new Set(this.assets.map((a) => a.mediaId));
  }

  runBatchArchive(): void {
    if (!this.selectedIds.size) return;
    this.clearToast();
    this.batchArchiving = true;
    const ids = Array.from(this.selectedIds);
    let ok = 0;
    let fail = 0;
    let i = 0;
    const step = (): void => {
      if (i >= ids.length) {
        this.batchArchiving = false;
        this.showToast(`Archivar: ${ok} correctos${fail ? `, ${fail} fallidos` : ''}.`, fail ? 'warn' : 'success');
        this.loadAssets();
        return;
      }
      const id = ids[i++];
      this.mediaApi.archiveMedia(id).subscribe({
        next: () => {
          ok++;
          step();
        },
        error: () => {
          fail++;
          step();
        }
      });
    };
    step();
  }

  runBatchDelete(): void {
    if (!this.selectedIds.size) return;
    this.clearToast();
    const sub = this.mediaApi.bulkDelete({ mediaIds: Array.from(this.selectedIds) }).subscribe({
      next: (res) => {
        const data = res.data;
        this.showToast(
          `Eliminación: ${data.processed} correctos${data.failed ? `, ${data.failed} fallidos` : ''}.`,
          data.failed > 0 ? 'warn' : 'success'
        );
        this.loadAssets();
        this.loadStorageSummary();
      },
      error: (err) => {
        this.showToast(extractErrorMessage(err, 'No se pudo ejecutar la eliminación por lote.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  runBatchTag(): void {
    if (!this.selectedIds.size) return;
    this.clearToast();
    this.batchTagsDraft = '';
    this.showBatchTagModal = true;
  }

  closeBatchTagModal(): void {
    this.showBatchTagModal = false;
    this.batchTagsDraft = '';
  }

  applyBatchTag(): void {
    const tagList = this.batchTagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tagList.length) {
      this.showToast('Ingresa al menos una etiqueta.', 'warn');
      return;
    }
    this.batchTagSaving = true;
    const sub = this.mediaApi.bulkTag({ mediaIds: Array.from(this.selectedIds), tags: tagList }).subscribe({
      next: (res) => {
        this.batchTagSaving = false;
        const data = res.data;
        this.showToast(
          `Etiquetado: ${data.processed} correctos${data.failed ? `, ${data.failed} fallidos` : ''}.`,
          data.failed > 0 ? 'warn' : 'success'
        );
        this.closeBatchTagModal();
        this.loadAssets();
      },
      error: (err) => {
        this.batchTagSaving = false;
        this.showToast(extractErrorMessage(err, 'No se pudo ejecutar el etiquetado por lote.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  previewUrl(): void {
    this.urlPreviewImageSrc = null;
    this.urlPreviewIsVideo = false;
    const url = this.urlDraft.trim();
    if (!url) {
      this.showToast('Pega una URL.', 'warn');
      return;
    }
    this.urlPreviewLoading = true;
    const sub = this.mediaApi.previewUrl({ url }).subscribe({
      next: (res) => {
        this.urlPreviewLoading = false;
        const data = res.data;
        this.urlPreviewIsVideo = data.type === 'video';
        this.urlPreviewImageSrc = data.thumbnailUrl || data.canonicalUrl || url;
      },
      error: () => {
        this.urlPreviewLoading = false;
        this.showToast('No se pudo validar por servidor; se muestra vista previa del navegador.', 'warn');
        this.urlPreviewImageSrc = url;
      }
    });
    this.subscriptions.add(sub);
  }

  importUrlToLibrary(): void {
    const url = this.urlDraft.trim();
    if (!url) {
      this.showToast('Pega una URL válida.', 'warn');
      return;
    }
    const tags = this.urlTagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    this.importingUrl = true;
    const sub = this.mediaApi
      .importUrl({
        url,
        name: this.urlName.trim() || undefined,
        tags: tags.length ? tags : undefined
      })
      .subscribe({
        next: () => {
          this.importingUrl = false;
          this.closeImportModal();
          this.resetUrlImportForm();
          this.loadAssets();
          this.loadStorageSummary();
          this.showToast('URL importada a la biblioteca.', 'success');
        },
        error: (err) => {
          this.importingUrl = false;
          this.showToast(extractErrorMessage(err, 'No se pudo importar la URL a la biblioteca.'), 'error');
        }
      });
    this.subscriptions.add(sub);
  }

  useUrlInComposer(): void {
    const url = this.urlDraft.trim();
    if (!url) {
      this.showToast('Pega una URL antes de continuar.', 'warn');
      return;
    }
    this.closeImportModal();
    this.mediaSelection.setPendingSelection({
      mediaId: null,
      publicUrl: url,
      thumbnailUrl: this.urlPreviewImageSrc || undefined,
      mimeType: this.urlPreviewIsVideo ? 'video/*' : 'image/*',
      name: 'Importado por URL'
    });
    this.router.navigate(['/dashboard/programador']);
  }

  archiveAsset(asset: MediaAsset): void {
    this.closeCardMenu();
    const sub = this.mediaApi.archiveMedia(asset.mediaId).subscribe({
      next: () => {
        this.showToast('Archivo archivado.', 'success');
        this.loadAssets();
      },
      error: (err) => {
        this.showToast(extractErrorMessage(err, 'No se pudo archivar el activo.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  deleteAsset(asset: MediaAsset): void {
    this.closeCardMenu();
    if (!confirm(`Eliminar "${asset.name}"?`)) return;
    const sub = this.mediaApi.deleteMedia(asset.mediaId).subscribe({
      next: () => {
        this.showToast('Archivo eliminado.', 'success');
        this.loadAssets();
        this.loadStorageSummary();
      },
      error: (err) => {
        this.showToast(extractErrorMessage(err, 'No se pudo eliminar el activo.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  editAsset(asset: MediaAsset): void {
    this.closeCardMenu();
    this.editingAsset = asset;
    this.editNameDraft = asset.name;
    this.editTagsDraft = (asset.tags || []).join(', ');
    this.showEditModal = true;
  }

  closeEditModal(): void {
    this.showEditModal = false;
    this.editingAsset = null;
  }

  saveEditAsset(): void {
    if (!this.editingAsset) return;
    const name = this.editNameDraft.trim();
    if (!name) {
      this.showToast('El nombre es obligatorio.', 'warn');
      return;
    }
    const tags = this.editTagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    this.editSaving = true;
    const sub = this.mediaApi.updateMedia(this.editingAsset.mediaId, { name, tags }).subscribe({
      next: () => {
        this.editSaving = false;
        this.closeEditModal();
        this.loadAssets();
        this.showToast('Cambios guardados.', 'success');
      },
      error: (err) => {
        this.editSaving = false;
        this.showToast(extractErrorMessage(err, 'No se pudo actualizar el activo.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  loadStorageSummary(): void {
    if (!this.storageSummaryReady) {
      this.storageLoading = true;
    }
    const sub = this.mediaApi.getStorageSummary().subscribe({
      next: (res) => {
        const d = res.data;
        this.usedBytes = d.usedBytes ?? 0;
        this.limitBytes = d.limitBytes ?? null;
        this.isUnlimited = !!d.isUnlimited;
        this.storageLoading = false;
        this.storageSummaryReady = true;
      },
      error: () => {
        this.storageLoading = false;
        this.storageSummaryReady = true;
      }
    });
    this.subscriptions.add(sub);
  }

  startOAuth(): void {
    if (this.oauthUiState === 'connecting' || this.oauthUiState === 'verifying_callback') {
      return;
    }
    this.oauthUiState = 'connecting';
    this.oauthUiMessage = 'Conectando con Google...';
    const sub = this.mediaApi.startOAuth(this.integrationProvider).subscribe({
      next: (res) => {
        const url = res.data.authorizationUrl;
        if (!url) {
          this.showToast('El backend no devolvió authorizationUrl.', 'error');
          this.oauthUiState = 'error';
          this.oauthUiMessage = 'No se pudo completar la conexión. Intenta nuevamente.';
          return;
        }
        window.open(url, '_self');
      },
      error: (err) => {
        this.showToast(extractErrorMessage(err, 'No se pudo iniciar OAuth del proveedor.'), 'error');
        this.oauthUiState = 'error';
        this.oauthUiMessage = 'No se pudo completar la conexión. Intenta nuevamente.';
      }
    });
    this.subscriptions.add(sub);
  }

  private tryProcessOAuthCallback(pathParams: ParamMap): void {
    if (this.callbackProcessed) return;
    const provider = pathParams.get('provider') ?? this.route.snapshot.queryParamMap.get('provider');
    const onCallbackRoute = this.router.url.includes('/oauth-callback/');
    if (!provider || !onCallbackRoute) return;
    this.callbackProcessed = true;
    this.oauthUiState = 'verifying_callback';
    this.oauthUiMessage = 'Validando autorizacion...';
    this.importModal = { kind: 'integration', provider: provider as Provider };
    // Backend-first: callback se resuelve en backend y frontend solo refresca status.
    this.refreshIntegrationStatus(provider as Provider, true);
  }

  importFromProvider(): void {
    const fileId = this.integrationFileId.trim();
    if (!fileId) {
      this.showToast('Selecciona un archivo para importar.', 'warn');
      return;
    }
    this.importingExternal = true;
    const tags = this.integrationImportTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const sub = this.mediaApi
      .importFromProvider(this.integrationProvider, {
        fileId,
        name: this.integrationImportName.trim() || undefined,
        tags: tags.length ? tags : undefined
      })
      .subscribe({
        next: () => {
          this.importingExternal = false;
          this.oauthUiState = 'connected';
          this.oauthUiMessage = 'Google Drive conectado correctamente.';
          this.showToast('Archivo importado correctamente.', 'success');
          this.integrationFileId = '';
          this.integrationImportName = '';
          this.integrationImportTags = '';
          this.selectedPickerFileName = '';
          this.selectedPickerMimeType = '';
          this.selectedDriveFile = null;
          this.loadDriveFiles(false);
          this.loadAssets();
          this.loadStorageSummary();
        },
        error: (err) => {
          this.importingExternal = false;
          this.showToast(extractErrorMessage(err, 'No se pudo importar desde integración.'), 'error');
          if (this.getHttpStatus(err) === 412) {
            this.oauthUiState = 'disconnected';
            this.oauthUiMessage = 'Integracion no conectada. Conecta Google Drive para continuar.';
          }
        }
      });
    this.subscriptions.add(sub);
  }

  private getHttpStatus(err: unknown): number | null {
    const anyErr = err as { status?: number } | null;
    return typeof anyErr?.status === 'number' ? anyErr.status : null;
  }

  private mapOAuthErrorMessage(err: unknown): string {
    const status = this.getHttpStatus(err);
    if (status === 401) return 'Sesion expirada. Inicia sesion nuevamente.';
    if (status === 403) return 'Sin acceso al tenant activo. Verifica permisos e intenta otra vez.';
    if (status === 400) return 'Autorizacion invalida o expirada. Reinicia la conexion.';
    if (status === 502) return 'Google no respondio correctamente. Reintenta la conexion.';
    return 'No se pudo completar la conexion. Intenta nuevamente.';
  }

  refreshIntegrationStatus(
    provider: Provider = this.integrationProvider,
    fromCallback = false,
    autoConnectIfDisconnected = false
  ): void {
    this.integrationStatusLoading = true;
    const sub = this.mediaApi.getIntegrationStatus(provider).subscribe({
      next: (res) => {
        const data = res.data;
        this.integrationStatusLoading = false;
        this.integrationConnectedAt = data.connectedAt ?? null;
        this.integrationAccountEmail = data.accountEmail ?? null;
        this.oauthUiState = data.connected ? 'connected' : 'disconnected';
        this.oauthUiMessage = data.connected
          ? 'Google Drive conectado correctamente.'
          : 'Aun no hay conexion activa con Google Drive.';
        if (!data.connected && autoConnectIfDisconnected && provider === 'google-drive') {
          this.startOAuth();
        }
        if (!(data.connected && provider === 'google-drive')) {
          this.driveFiles = [];
          this.selectedDriveFile = null;
          this.integrationFileId = '';
        }
        if (fromCallback) {
          this.showToast(
            data.connected
              ? `Conexión con ${provider} completada.`
              : `No se confirmó conexión activa con ${provider}.`,
            data.connected ? 'success' : 'warn'
          );
          this.router.navigate(['/dashboard/archivos'], {
            replaceUrl: true,
            queryParams: {
              mode: this.selectionMode ? 'select' : null,
              status: this.statusFilter,
              openImport: provider === 'google-drive' && data.connected ? 'google-drive' : null,
              code: null,
              state: null,
              iss: null,
              scope: null
            },
            queryParamsHandling: 'merge'
          });
        }
      },
      error: (err) => {
        this.integrationStatusLoading = false;
        this.oauthUiState = 'error';
        this.oauthUiMessage = this.mapOAuthErrorMessage(err);
        if (fromCallback) {
          this.showToast(extractErrorMessage(err, `No se pudo confirmar estado de ${provider}.`), 'error');
          this.callbackProcessed = false;
        } else {
          this.showToast(this.mapOAuthErrorMessage(err), 'error');
        }
      }
    });
    this.subscriptions.add(sub);
  }

  disconnectDrive(): void {
    const sub = this.mediaApi.disconnectIntegration(this.integrationProvider).subscribe({
      next: () => {
        this.integrationFileId = '';
        this.integrationImportName = '';
        this.integrationImportTags = '';
        this.oauthUiState = 'disconnected';
        this.oauthUiMessage = 'Integracion desconectada.';
        this.integrationConnectedAt = null;
        this.integrationAccountEmail = null;
        this.driveFiles = [];
        this.selectedDriveFile = null;
        this.integrationFileId = '';
        this.showToast('Integración desconectada.', 'success');
      },
      error: (err) => {
        this.showToast(extractErrorMessage(err, 'No se pudo desconectar la integracion.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  loadDriveFiles(resetPage = false): void {
    if (this.integrationProvider !== 'google-drive') return;
    if (this.oauthUiState !== 'connected') return;
    if (resetPage) {
      this.drivePage = 1;
    }
    this.driveFilesLoading = true;
    const sub = this.mediaApi
      .listIntegrationFiles('google-drive', {
        q: this.driveQuery,
        page: this.drivePage,
        pageSize: this.drivePageSize
      })
      .subscribe({
        next: (res) => {
          const list = Array.isArray(res.data) ? res.data : [];
          this.driveFiles = list.map((x) => this.mapDriveFile(x));
          this.driveTotalPages = Math.max(1, Number(res.meta?.totalPages ?? 1));
          this.driveFilesLoading = false;
          this.showDriveFallbackList = true;
        },
        error: (err) => {
          this.driveFilesLoading = false;
          if (this.getHttpStatus(err) === 412) {
            this.oauthUiState = 'disconnected';
            this.oauthUiMessage = 'Integracion no conectada. Vuelve a conectar Google Drive.';
          }
          this.showToast(extractErrorMessage(err, 'No se pudo cargar el listado de Google Drive.'), 'error');
        }
      });
    this.subscriptions.add(sub);
  }

  searchDriveFiles(): void {
    this.loadDriveFiles(true);
  }

  prevDrivePage(): void {
    if (this.drivePage <= 1) return;
    this.drivePage--;
    this.loadDriveFiles(false);
  }

  nextDrivePage(): void {
    if (this.drivePage >= this.driveTotalPages) return;
    this.drivePage++;
    this.loadDriveFiles(false);
  }

  selectDriveFile(file: DriveFileUiItem): void {
    this.selectedDriveFile = file;
    this.integrationFileId = file.fileId;
    if (!this.integrationImportName.trim()) {
      this.integrationImportName = file.name;
    }
  }

  onDriveFileDoubleClick(file: DriveFileUiItem): void {
    this.selectDriveFile(file);
    this.importFromProvider();
  }

  openGooglePicker(): void {
    this.pickerLoading = true;
    const sub = this.mediaApi.getIntegrationPickerToken('google-drive').subscribe({
      next: (res) => {
        const token = res.data;
        this.resolvePickerApiKey(token)
          .then((apiKey) =>
            this.googlePicker.openPicker({
              apiKey,
              oauthToken: token.oauthToken,
              appId: token.appId || undefined
            })
          )
          .then((picked) => {
            this.pickerLoading = false;
            if (!picked) return;
            this.applyPickedFileAndImport(picked);
          })
          .catch((err: unknown) => {
            this.pickerLoading = false;
            this.showToast(extractErrorMessage(err as any, 'No se pudo abrir Google Picker.'), 'error');
          });
      },
      error: (err) => {
        this.pickerLoading = false;
        this.showToast(extractErrorMessage(err, 'No se pudo obtener token para Google Picker.'), 'error');
      }
    });
    this.subscriptions.add(sub);
  }

  private resolvePickerApiKey(token: IntegrationPickerTokenDto): Promise<string> {
    if (token.apiKey?.trim()) return Promise.resolve(token.apiKey.trim());
    const fromWindow = (window as unknown as { __GOOGLE_PICKER_API_KEY__?: string }).__GOOGLE_PICKER_API_KEY__;
    if (typeof fromWindow === 'string' && fromWindow.trim()) return Promise.resolve(fromWindow.trim());
    return Promise.reject(new Error('No hay apiKey para Google Picker.'));
  }

  private applyPickedFileAndImport(file: PickedGoogleFile): void {
    if (!file.fileId) return;
    this.integrationFileId = file.fileId;
    this.selectedPickerFileName = file.name?.trim() || 'Archivo seleccionado';
    this.selectedPickerMimeType = file.mimeType?.trim() || '';
    if (!this.integrationImportName.trim()) {
      this.integrationImportName = file.name?.trim() || 'Archivo de Google Drive';
    }
  }

  setDriveTypeFilter(filter: DriveTypeFilter): void {
    this.driveTypeFilter = filter;
  }

  setDriveViewMode(mode: DriveViewMode): void {
    this.driveViewMode = mode;
  }

  get visibleDriveFiles(): DriveFileUiItem[] {
    return this.driveFiles.filter((f) => this.matchesDriveTypeFilter(f));
  }

  private matchesDriveTypeFilter(file: DriveFileUiItem): boolean {
    if (this.driveTypeFilter === 'all') return true;
    const mime = (file.mimeType || '').toLowerCase();
    if (this.driveTypeFilter === 'image') return mime.startsWith('image/');
    if (this.driveTypeFilter === 'video') return mime.startsWith('video/');
    if (this.driveTypeFilter === 'document') {
      return (
        mime.includes('pdf') ||
        mime.includes('document') ||
        mime.includes('sheet') ||
        mime.includes('presentation') ||
        mime.includes('text/')
      );
    }
    return !mime.startsWith('image/') && !mime.startsWith('video/');
  }

  private mapDriveFile(it: IntegrationFileItemDto): DriveFileUiItem {
    const anyIt = it as unknown as Record<string, unknown>;
    const fileId =
      (typeof anyIt['fileId'] === 'string' ? anyIt['fileId'] : undefined) ??
      (typeof anyIt['id'] === 'string' ? anyIt['id'] : '');
    return {
      fileId,
      name: typeof anyIt['name'] === 'string' ? anyIt['name'] : 'Sin nombre',
      mimeType: typeof anyIt['mimeType'] === 'string' ? anyIt['mimeType'] : undefined,
      thumbnailUrl: typeof anyIt['thumbnailUrl'] === 'string' ? anyIt['thumbnailUrl'] : undefined,
      modifiedTime: typeof anyIt['modifiedTime'] === 'string' ? anyIt['modifiedTime'] : undefined,
      sizeBytes: typeof anyIt['sizeBytes'] === 'number' ? anyIt['sizeBytes'] : undefined
    };
  }

  usedPercent(): number {
    if (this.isUnlimited || !this.limitBytes || this.limitBytes <= 0) return 0;
    return Math.min(100, Math.round((this.usedBytes / this.limitBytes) * 100));
  }

  formatBytes(v: number | null): string {
    if (v == null) return 'Ilimitado';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = v;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  isImage(asset: MediaAsset): boolean {
    return asset.mimeType.startsWith('image/');
  }

  isVideo(asset: MediaAsset): boolean {
    return asset.mimeType.startsWith('video/');
  }

  assetBadgeLabel(asset: MediaAsset): 'Imagen' | 'Video' | 'Documento' | 'Archivo' {
    const mime = (asset.mimeType || '').toLowerCase();
    if (mime.startsWith('video/')) return 'Video';
    if (mime.startsWith('image/')) return 'Imagen';
    if (
      mime.includes('pdf') ||
      mime.includes('document') ||
      mime.includes('sheet') ||
      mime.includes('presentation') ||
      mime.includes('text/')
    ) {
      return 'Documento';
    }
    return 'Archivo';
  }

  formatMimeShort(mime: string): string {
    if (!mime || mime === 'application/octet-stream') return 'Archivo';
    const [type, sub] = mime.split('/');
    if (!sub) return mime;
    if (type === 'image' || type === 'video') return sub.toUpperCase();
    return sub;
  }

  onFolderColorInputChange(value: string): void {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) {
      this.folderFormColorHex = '';
      return;
    }
    this.folderFormColorHex = raw.startsWith('#') ? raw : `#${raw}`;
  }

  selectPaletteFolderColor(colorHex: string): void {
    this.folderFormColorHex = this.normalizeFolderColor(colorHex);
  }

  isPaletteFolderColorSelected(colorHex: string): boolean {
    return this.folderFormColorHex === this.normalizeFolderColor(colorHex);
  }

  folderNameCharCount(): number {
    return this.folderFormName.trim().length;
  }

  focusCustomColorInput(input: HTMLInputElement): void {
    input.focus();
    input.select();
  }

  folderColorHexOrDefault(colorHex?: string | null): string {
    return this.normalizeFolderColor(colorHex);
  }

  private normalizeFolderColor(raw?: string | null): string {
    const value = String(raw ?? '').trim().toUpperCase();
    if (this.isValidFolderColorHex(value)) {
      return value;
    }
    return GestorArchivosComponent.DEFAULT_FOLDER_COLOR_HEX;
  }

  private isValidFolderColorHex(value: string): boolean {
    return /^#[0-9A-F]{6}$/.test(value);
  }

  formatAssetSize(asset: MediaAsset): string {
    if (asset.sizeBytes == null) return '';
    return this.formatBytes(asset.sizeBytes);
  }

  integrationTitle(provider: Provider): string {
    switch (provider) {
      case 'google-drive':
        return 'Google Drive';
      case 'onedrive':
        return 'OneDrive';
      case 'canva':
        return 'Canva';
      default:
        return provider;
    }
  }

  oauthStateLabel(): string {
    switch (this.oauthUiState) {
      case 'disconnected':
        return 'Sin conexión';
      case 'connecting':
        return 'Conectando...';
      case 'verifying_callback':
        return 'Comprobando...';
      case 'connected':
        return 'Conectado';
      case 'error':
        return 'Error de conexión';
      default:
        return '';
    }
  }

  connectAccountButtonLabel(): string {
    if (this.oauthUiState === 'connecting') return 'Conectando...';
    if (this.oauthUiState === 'verifying_callback') return 'Comprobando...';
    if (this.oauthUiState === 'error') return 'Volver a conectar con Google';
    return 'Conectar con Google';
  }

  integrationImportFooterHint(): string {
    if (this.oauthUiState !== 'connected') {
      return 'Aún no hay conexión activa con Google Drive.';
    }
    if (!this.integrationFileId.trim()) {
      return 'Aún no has seleccionado un archivo.';
    }
    return '1 archivo listo para importar';
  }
}
