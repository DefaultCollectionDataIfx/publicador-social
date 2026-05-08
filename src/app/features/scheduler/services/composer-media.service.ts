import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface ApiResponse<T> {
  data: T;
  meta?: {
    totalCount?: number;
    pageSize?: number;
    currentPage?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
    nextPageUrl?: string;
    previousPageUrl?: string;
    [key: string]: unknown;
  };
}

/** Contrato maduro para POST /api/media/upload. */
export interface MediaUploadResponseBody {
  mediaId: number;
  publicUrl: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  hasThumbnail?: boolean;
  hasPreview?: boolean;
  processingStatus?: 'pending' | 'completed' | 'failed';
  mimeType: string;
  width?: number | null;
  height?: number | null;
}

/** Ítem de biblioteca (GET /api/media) — alineado con `MediaListItemDto` del API. */
export interface MediaLibraryItemDto {
  mediaId?: number;
  /** Compatibilidad con respuestas antiguas que exponían `id`. */
  id?: number;
  folderId?: number | null;
  folderName?: string | null;
  thumbnailUrl?: string;
  previewUrl?: string | null;
  publicUrl?: string;
  hasThumbnail?: boolean;
  hasPreview?: boolean;
  processingStatus?: 'pending' | 'completed' | 'failed';
  mimeType: string;
  createdAt: string;
  name?: string;
  source?: string;
  status?: 'active' | 'archived';
  isInUse?: boolean;
  usageCount?: number;
  lastUsedAt?: string;
  tags?: string[];
  sizeBytes?: number;
}

/** Detalle por id (`GET /api/media/{id}`) — alineado con `MediaDetailDto` del API. */
export interface MediaDetailDto extends MediaLibraryItemDto {
  tenantId?: number;
  createdByUserId?: number;
  width?: number | null;
  height?: number | null;
  updatedAt?: string | null;
}

/** Valores de `sort` admitidos por GET /api/media (orden global antes de paginar). */
export type MediaListSortParam =
  | 'recently_uploaded'
  | 'recently_used'
  | 'most_used'
  | 'name_asc'
  | 'name_desc'
  | 'size_desc';

export interface MediaLibraryListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: 'active' | 'archived';
  sort?: MediaListSortParam;
  folderId?: number | null;
  /** Si true, el backend filtra a medios con carpeta nula (vista raíz de biblioteca). */
  withoutFolder?: boolean;
  /** Filtro por clase MIME según el API (`image` \| `video` \| `document`). */
  type?: 'image' | 'video' | 'document';
  /** Prefijo MIME, p. ej. `image/jpeg` o `image/`. */
  mimeType?: string;
}

export interface MediaFolderDto {
  folderId: number;
  parentFolderId: number | null;
  name: string;
  colorHex: string;
  normalizedName: string;
  depth: number;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateMediaFolderRequestDto {
  parentFolderId: number | null;
  name: string;
  colorHex?: string;
}

export interface UpdateMediaFolderRequestDto {
  parentFolderId: number | null;
  name: string;
  colorHex?: string;
}

export interface MediaUpdateRequest {
  name?: string;
  status?: 'active' | 'archived';
  tags?: string[];
}

export interface MoveMediaRequestDto {
  folderId: number | null;
}

export interface BulkMoveMediaRequestDto {
  mediaIds: number[];
  folderId: number | null;
}

/** POST /api/media/preview-url */
export interface MediaPreviewUrlRequest {
  url: string;
}

export interface MediaPreviewUrlResponseBody {
  ok: boolean;
  type: 'image' | 'video' | 'unknown';
  canonicalUrl: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface MediaImportUrlRequest {
  url: string;
  name?: string;
  tags?: string[];
}

export interface BulkOperationResultItem {
  mediaId: number;
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
}

export interface BulkOperationResultDto {
  totalRequested: number;
  processed: number;
  failed: number;
  results: BulkOperationResultItem[];
}

export interface BulkDeleteRequest {
  mediaIds: number[];
}

export interface BulkTagRequest {
  mediaIds: number[];
  tags: string[];
}

export interface StorageSummaryDto {
  usedBytes: number;
  limitBytes: number | null;
  availableBytes: number | null;
  isUnlimited: boolean;
}

export interface IntegrationOAuthStartResponseDto {
  provider: string;
  authorizationUrl: string;
  state?: string;
}

export interface ExternalImportRequestDto {
  fileId: string;
  name?: string;
  tags?: string[];
}

export interface IntegrationStatusResponseDto {
  provider: string;
  connected: boolean;
  connectedAt?: string | null;
  accountEmail?: string | null;
}

export interface IntegrationFileItemDto {
  fileId: string;
  name: string;
  mimeType?: string;
  thumbnailUrl?: string;
  modifiedTime?: string;
  sizeBytes?: number;
}

export interface IntegrationFilesQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface IntegrationPickerTokenDto {
  oauthToken: string;
  apiKey?: string;
  appId?: string;
}

/** POST /api/media/{mediaId}/edit-image — recorte normalizado sobre imagen orientada (EXIF). */
export interface MediaEditImageCropDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaEditImageOutputDto {
  width: number;
  height: number;
  format: 'webp' | 'jpeg' | 'jpg';
  quality: number;
}

export interface MediaEditImageTransformDto {
  rotateDeg: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface MediaEditImageRequestDto {
  mode: 'save_as_copy';
  preset: string;
  outputName?: string;
  output: MediaEditImageOutputDto;
  crop: MediaEditImageCropDto;
  transform?: MediaEditImageTransformDto;
  folderId?: number | null;
  tags?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ComposerMediaService {
  private readonly base = '/api/media';

  constructor(private http: HttpClient) {}

  uploadMedia(file: File): Observable<ApiResponse<MediaUploadResponseBody>> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<ApiResponse<MediaUploadResponseBody>>(`${this.base}/upload`, formData).pipe(
      catchError((err) =>
        throwError(() => err)
      )
    );
  }

  listMedia(query: MediaLibraryListQuery = {}): Observable<ApiResponse<MediaLibraryItemDto[]>> {
    let params = new HttpParams()
      .set('page', String(query.page ?? 1))
      .set('pageSize', String(query.pageSize ?? 24));
    if (query.q?.trim()) {
      params = params.set('q', query.q.trim());
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    if (query.sort) {
      params = params.set('sort', query.sort);
    }
    if (typeof query.folderId === 'number') {
      params = params.set('folderId', String(query.folderId));
    }
    if (query.withoutFolder) {
      params = params.set('withoutFolder', 'true');
    }
    if (query.type) {
      params = params.set('type', query.type);
    }
    if (query.mimeType?.trim()) {
      params = params.set('mimeType', query.mimeType.trim());
    }
    return this.http.get<ApiResponse<MediaLibraryItemDto[]>>(this.base, { params }).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  listFolders(): Observable<ApiResponse<MediaFolderDto[]>> {
    return this.http.get<ApiResponse<MediaFolderDto[]>>(`${this.base}/folders`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  createFolder(body: CreateMediaFolderRequestDto): Observable<ApiResponse<MediaFolderDto>> {
    return this.http.post<ApiResponse<MediaFolderDto>>(`${this.base}/folders`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  getFolder(folderId: number): Observable<ApiResponse<MediaFolderDto>> {
    return this.http.get<ApiResponse<MediaFolderDto>>(`${this.base}/folders/${folderId}`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  updateFolder(folderId: number, body: UpdateMediaFolderRequestDto): Observable<ApiResponse<MediaFolderDto>> {
    return this.http.patch<ApiResponse<MediaFolderDto>>(`${this.base}/folders/${folderId}`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  deleteFolder(folderId: number): Observable<ApiResponse<{ deleted: boolean }>> {
    return this.http.delete<ApiResponse<{ deleted: boolean }>>(`${this.base}/folders/${folderId}`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  getFolderAncestors(folderId: number): Observable<ApiResponse<MediaFolderDto[]>> {
    return this.http.get<ApiResponse<MediaFolderDto[]>>(`${this.base}/folders/${folderId}/ancestors`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  getMedia(id: number): Observable<ApiResponse<MediaDetailDto>> {
    return this.http.get<ApiResponse<MediaDetailDto>>(`${this.base}/${id}`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  editImage(
    mediaId: number,
    body: MediaEditImageRequestDto,
    options?: { idempotencyKey?: string }
  ): Observable<ApiResponse<MediaDetailDto>> {
    let headers = new HttpHeaders();
    const key = options?.idempotencyKey?.trim();
    if (key) {
      headers = headers.set('Idempotency-Key', key);
    }
    return this.http
      .post<ApiResponse<MediaDetailDto>>(`${this.base}/${mediaId}/edit-image`, body, {
        headers
      })
      .pipe(catchError((err) => throwError(() => err)));
  }

  previewUrl(body: MediaPreviewUrlRequest): Observable<ApiResponse<MediaPreviewUrlResponseBody>> {
    return this.http.post<ApiResponse<MediaPreviewUrlResponseBody>>(`${this.base}/preview-url`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  importUrl(body: MediaImportUrlRequest): Observable<ApiResponse<MediaUploadResponseBody>> {
    return this.http.post<ApiResponse<MediaUploadResponseBody>>(`${this.base}/import-url`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  archiveMedia(id: number): Observable<ApiResponse<MediaLibraryItemDto>> {
    return this.http.post<ApiResponse<MediaLibraryItemDto>>(`${this.base}/${id}/archive`, {}).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  deleteMedia(id: number): Observable<ApiResponse<{ deleted: boolean }>> {
    return this.http.delete<ApiResponse<{ deleted: boolean }>>(`${this.base}/${id}`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  updateMedia(id: number, body: MediaUpdateRequest): Observable<ApiResponse<MediaLibraryItemDto>> {
    return this.http.patch<ApiResponse<MediaLibraryItemDto>>(`${this.base}/${id}`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  moveMedia(mediaId: number, body: MoveMediaRequestDto): Observable<ApiResponse<MediaLibraryItemDto>> {
    return this.http.post<ApiResponse<MediaLibraryItemDto>>(`${this.base}/${mediaId}/move`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  bulkMoveMedia(body: BulkMoveMediaRequestDto): Observable<ApiResponse<BulkOperationResultDto>> {
    return this.http.post<ApiResponse<BulkOperationResultDto>>(`${this.base}/bulk-move`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  bulkDelete(body: BulkDeleteRequest): Observable<ApiResponse<BulkOperationResultDto>> {
    return this.http.post<ApiResponse<BulkOperationResultDto>>(`${this.base}/bulk-delete`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  bulkTag(body: BulkTagRequest): Observable<ApiResponse<BulkOperationResultDto>> {
    return this.http.post<ApiResponse<BulkOperationResultDto>>(`${this.base}/bulk-tag`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  getStorageSummary(): Observable<ApiResponse<StorageSummaryDto>> {
    return this.http.get<ApiResponse<StorageSummaryDto>>(`${this.base}/storage-summary`).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  startOAuth(provider: string): Observable<ApiResponse<IntegrationOAuthStartResponseDto>> {
    return this.http
      .get<ApiResponse<IntegrationOAuthStartResponseDto>>(`/api/integrations/${encodeURIComponent(provider)}/oauth/start`)
      .pipe(catchError((err) => throwError(() => err)));
  }

  importFromProvider(
    provider: string,
    body: ExternalImportRequestDto
  ): Observable<ApiResponse<MediaUploadResponseBody>> {
    return this.http
      .post<ApiResponse<MediaUploadResponseBody>>(`/api/integrations/${encodeURIComponent(provider)}/import`, body)
      .pipe(catchError((err) => throwError(() => err)));
  }

  getIntegrationStatus(provider: string): Observable<ApiResponse<IntegrationStatusResponseDto>> {
    return this.http
      .get<ApiResponse<IntegrationStatusResponseDto>>(`/api/integrations/${encodeURIComponent(provider)}/status`)
      .pipe(catchError((err) => throwError(() => err)));
  }

  disconnectIntegration(provider: string): Observable<ApiResponse<{ disconnected?: boolean }>> {
    return this.http
      .post<ApiResponse<{ disconnected?: boolean }>>(`/api/integrations/${encodeURIComponent(provider)}/disconnect`, {})
      .pipe(catchError((err) => throwError(() => err)));
  }

  listIntegrationFiles(
    provider: string,
    query: IntegrationFilesQuery = {}
  ): Observable<ApiResponse<IntegrationFileItemDto[]>> {
    let params = new HttpParams()
      .set('page', String(query.page ?? 1))
      .set('pageSize', String(query.pageSize ?? 24));
    if (query.q?.trim()) {
      params = params.set('q', query.q.trim());
    }
    return this.http
      .get<ApiResponse<IntegrationFileItemDto[]>>(`/api/integrations/${encodeURIComponent(provider)}/files`, { params })
      .pipe(catchError((err) => throwError(() => err)));
  }

  getIntegrationPickerToken(provider: string): Observable<ApiResponse<IntegrationPickerTokenDto>> {
    return this.http
      .get<ApiResponse<IntegrationPickerTokenDto>>(`/api/integrations/${encodeURIComponent(provider)}/picker-token`)
      .pipe(catchError((err) => throwError(() => err)));
  }
}
