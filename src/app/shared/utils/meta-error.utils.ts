import { HttpErrorResponse } from '@angular/common/http';
import { extractErrorMessage } from './error.utils';

export interface MetaErrorInfo {
  message: string;
  errorCode: string | null;
}

const META_ERROR_HINTS: Record<string, string> = {
  META_INSTAGRAM_MEDIA_REQUIRED: 'Instagram requiere al menos una imagen o video.',
  META_POST_PLAN_AMBIGUOUS_MEDIA_SOURCES: 'No combines mediaId con planMedia en la misma publicación.',
  META_CAPABILITY_NOT_SUPPORTED: 'La cuenta seleccionada no admite este tipo de contenido.',
  META_IG_CAROUSEL_ITEM_COUNT_INVALID: 'El carrusel debe tener entre 2 y 10 elementos.',
  META_IG_CAROUSEL_MIXED_NOT_SUPPORTED: 'El carrusel mixto (imagen + video) no está habilitado en este entorno.',
  META_IG_CAROUSEL_VIDEO_ONLY_NOT_SUPPORTED: 'El carrusel solo con videos no está habilitado.',
  META_IG_MEDIA_MIME_NOT_ALLOWED: 'Formato de archivo no permitido para Instagram.',
  META_IG_MEDIA_TOO_LARGE: 'El archivo excede el tamaño máximo permitido.',
  META_IG_MEDIA_DURATION_EXCEEDED: 'El video es demasiado largo.',
  META_IG_PUBLISHING_LIMIT_EXCEEDED: 'Se agotó el cupo de publicaciones de Instagram (24 h).',
  META_IG_PUBLISHING_LIMIT_UNAVAILABLE: 'No se pudo consultar el cupo de Instagram. Intenta más tarde.',
  META_IG_CONTAINER_PROCESSING_FAILED: 'Instagram rechazó el procesamiento del contenido.',
  META_IG_CONTAINER_PROCESSING_TIMEOUT: 'El procesamiento en Instagram tardó demasiado.',
  META_IG_CONTAINER_EXPIRED: 'El contenedor expiró en Instagram antes de publicarse.',
  META_IG_PUBLISHING_LIMIT_TIMEOUT: 'Se agotó el tiempo de espera por cupo de Instagram.'
};

export function extractMetaErrorCode(error: HttpErrorResponse | Error): string | null {
  if (!(error instanceof HttpErrorResponse) || !error.error) {
    return null;
  }
  const body = error.error;
  if (typeof body.errorCode === 'string') {
    return body.errorCode;
  }
  return null;
}

export function extractMetaError(
  error: HttpErrorResponse | Error,
  defaultMessage = 'Ha ocurrido un error. Por favor, intenta nuevamente.'
): MetaErrorInfo {
  const errorCode = extractMetaErrorCode(error);
  const baseMessage = extractErrorMessage(error, defaultMessage);
  const hint = errorCode ? META_ERROR_HINTS[errorCode] : null;
  return {
    message: hint ? `${baseMessage} ${hint}` : baseMessage,
    errorCode
  };
}

export function getPublishStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    Pending: 'Programado',
    Publishing: 'Publicando',
    Published: 'Publicado',
    Failed: 'Fallido',
    RetryPending: 'Esperando cupo de Instagram',
    Skipped: 'Omitido',
    Cancelled: 'Cancelado'
  };
  return labels[status] ?? status;
}
