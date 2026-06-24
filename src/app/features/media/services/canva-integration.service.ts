import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError, timer } from 'rxjs';
import { catchError, concatMap, filter, map, switchMap, take, timeout } from 'rxjs/operators';
import { ApiResponse, MediaUploadResponseBody } from '../../scheduler/services/composer-media.service';

export type CanvaExportFormat = 'png' | 'jpg' | 'mp4';
export type CanvaDesignOwnership = 'owned' | 'shared' | 'any';
export type CanvaDesignSortBy =
  | 'modified_desc'
  | 'modified_asc'
  | 'created_desc'
  | 'created_asc';
export type CanvaExportJobStatus = 'in_progress' | 'success' | 'failed';

export interface CanvaDesignDto {
  designId: string;
  title: string;
  thumbnailUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  owner?: string;
}

export interface CanvaDesignListResponseDto {
  provider?: string;
  items: CanvaDesignDto[];
  continuation?: string | null;
}

export interface CanvaDesignListQuery {
  query?: string;
  pageSize?: number;
  ownership?: CanvaDesignOwnership;
  sortBy?: CanvaDesignSortBy;
  continuation?: string;
}

export interface CanvaExportFormatOptionDto {
  format: CanvaExportFormat | string;
  enabled: boolean;
}

export interface CanvaExportFormatsResponseDto {
  provider?: string;
  designId?: string;
  formats: CanvaExportFormatOptionDto[] | CanvaExportFormat[];
  minPage?: number;
  maxPage?: number;
}

const VALID_CANVA_FORMATS = new Set<CanvaExportFormat>(['png', 'jpg', 'mp4']);

/** Normaliza la respuesta del API (`{ format, enabled }[]` o `string[]`). */
export function parseEnabledCanvaFormats(
  raw: CanvaExportFormatsResponseDto['formats'] | undefined
): CanvaExportFormat[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvaExportFormat[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const f = item.toLowerCase();
      if (VALID_CANVA_FORMATS.has(f as CanvaExportFormat)) {
        out.push(f as CanvaExportFormat);
      }
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const option = item as CanvaExportFormatOptionDto;
    if (option.enabled === false) continue;
    const f = String(option.format ?? '').toLowerCase();
    if (f === 'png' || f === 'jpg' || f === 'mp4') {
      out.push(f);
    }
  }
  return out;
}

export interface CanvaExportRequestDto {
  format: CanvaExportFormat;
  pages?: number[];
  quality?: number;
}

export interface CanvaExportStartResponseDto {
  provider?: string;
  exportJobId: string;
  status: CanvaExportJobStatus;
}

export interface CanvaExportFileDto {
  format: CanvaExportFormat;
  page?: number;
  expiresAt?: string;
}

export interface CanvaExportStatusResponseDto {
  provider?: string;
  exportJobId: string;
  status: CanvaExportJobStatus;
  files?: CanvaExportFileDto[];
  errorCode?: string;
  errorMessage?: string;
}

export interface CanvaImportExportRequestDto {
  name: string;
  tags?: string[];
  sourceDesignId: string;
}

export interface CanvaSourceMetadataDto {
  provider?: string;
  designId?: string;
  exportJobId?: string;
  format?: CanvaExportFormat;
  page?: number;
}

export interface CanvaImportResultDto extends MediaUploadResponseBody {
  name: string;
  source?: string;
  sourceMetadata?: CanvaSourceMetadataDto;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

@Injectable({ providedIn: 'root' })
export class CanvaIntegrationService {
  private readonly base = '/api/integrations/canva';

  constructor(private readonly http: HttpClient) {}

  listDesigns(query: CanvaDesignListQuery = {}): Observable<ApiResponse<CanvaDesignListResponseDto>> {
    let params = new HttpParams();
    const q = query.query?.trim();
    if (q) {
      params = params.set('query', q);
    }
    if (typeof query.pageSize === 'number') {
      params = params.set('pageSize', String(query.pageSize));
    }
    if (query.ownership) {
      params = params.set('ownership', query.ownership);
    }
    if (query.sortBy) {
      params = params.set('sortBy', query.sortBy);
    }
    const continuation = query.continuation?.trim();
    if (continuation) {
      params = params.set('continuation', continuation);
    }
    return this.http
      .get<ApiResponse<CanvaDesignListResponseDto>>(`${this.base}/designs`, { params })
      .pipe(catchError((err) => throwError(() => err)));
  }

  getExportFormats(designId: string): Observable<ApiResponse<CanvaExportFormatsResponseDto>> {
    return this.http
      .get<ApiResponse<CanvaExportFormatsResponseDto>>(
        `${this.base}/designs/${encodeURIComponent(designId)}/export-formats`
      )
      .pipe(catchError((err) => throwError(() => err)));
  }

  startExport(
    designId: string,
    body: CanvaExportRequestDto
  ): Observable<ApiResponse<CanvaExportStartResponseDto>> {
    return this.http
      .post<ApiResponse<CanvaExportStartResponseDto>>(
        `${this.base}/designs/${encodeURIComponent(designId)}/export`,
        body
      )
      .pipe(catchError((err) => throwError(() => err)));
  }

  getExportStatus(exportJobId: string): Observable<ApiResponse<CanvaExportStatusResponseDto>> {
    return this.http
      .get<ApiResponse<CanvaExportStatusResponseDto>>(
        `${this.base}/exports/${encodeURIComponent(exportJobId)}`
      )
      .pipe(catchError((err) => throwError(() => err)));
  }

  importExport(
    exportJobId: string,
    body: CanvaImportExportRequestDto
  ): Observable<ApiResponse<CanvaImportResultDto>> {
    return this.http
      .post<ApiResponse<CanvaImportResultDto>>(
        `${this.base}/exports/${encodeURIComponent(exportJobId)}/import`,
        body
      )
      .pipe(catchError((err) => throwError(() => err)));
  }

  pollExportUntilReady(exportJobId: string): Observable<CanvaExportStatusResponseDto> {
    return timer(0, POLL_INTERVAL_MS).pipe(
      concatMap(() => this.getExportStatus(exportJobId)),
      map((res) => res.data),
      filter((data) => data.status !== 'in_progress'),
      take(1),
      timeout(POLL_TIMEOUT_MS),
      switchMap((data) => {
        if (data.status === 'failed') {
          const code = data.errorCode?.trim() || 'CANVA_EXPORT_FAILED';
          const message =
            data.errorMessage?.trim() || mapCanvaExportFailureMessage(code);
          return throwError(() => ({
            status: 502,
            error: { code, message }
          }));
        }
        if (data.status !== 'success') {
          return throwError(() => ({
            status: 408,
            error: {
              code: 'CANVA_EXPORT_TIMEOUT',
              message: 'La exportación tardó más de lo esperado.'
            }
          }));
        }
        return of(data);
      }),
      catchError((err) => {
        if (err?.name === 'TimeoutError') {
          return throwError(() => ({
            status: 408,
            error: {
              code: 'CANVA_EXPORT_TIMEOUT',
              message: 'La exportación tardó más de lo esperado.'
            }
          }));
        }
        return throwError(() => err);
      })
    );
  }
}

function mapCanvaExportFailureMessage(code: string): string {
  switch (code.toLowerCase()) {
    case 'license_required':
      return 'Canva requiere una licencia para exportar este diseño.';
    case 'approval_required':
      return 'Este diseño necesita aprobación en Canva antes de exportarse.';
    case 'internal_failure':
      return 'Canva no pudo completar la exportación. Intenta de nuevo.';
    default:
      return 'La exportación del diseño falló.';
  }
}
