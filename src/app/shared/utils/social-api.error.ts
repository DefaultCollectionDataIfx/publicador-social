import { HttpErrorResponse } from '@angular/common/http';
import { extractErrorMessage } from './error.utils';

import { SocialConnectionTypeStatus } from '../../features/social/models/social.model';

export type SocialAccountDeleteErrorCode =
  | 'SOCIAL_ACCOUNT_DELETE_NOT_ELIGIBLE'
  | 'SOCIAL_ACCOUNT_DELETE_PENDING_PUBLICATIONS'
  | 'SOCIAL_ACCOUNT_DELETE_HAS_CHILD_ACCOUNTS';

export type SocialConnectionErrorCode =
  | 'SOCIAL_CONNECTION_LIMIT_REACHED'
  | 'SOCIAL_CONNECTION_NOT_FOUND'
  | 'SOCIAL_CONNECTION_REAUTH_REQUIRED'
  | 'SOCIAL_IG_ACCOUNT_LIMIT_REACHED'
  | 'SOCIAL_THREADS_ACCOUNT_LIMIT_REACHED'
  | 'SOCIAL_CONNECTION_REAUTH_USER_MISMATCH'
  | 'LINKEDIN_ORGANIZATION_LIMIT_REACHED'
  | 'LINKEDIN_NO_ADMIN_ORGANIZATIONS';

export type SocialAccountConnectErrorCode =
  | 'SOCIAL_ACCOUNT_LIMIT_REACHED'
  | 'SOCIAL_ACCOUNT_ALREADY_CONNECTED'
  | 'SOCIAL_ACCOUNT_CONNECT_NOT_ELIGIBLE'
  | 'SOCIAL_ACCOUNT_STATUS_PATCH_DEPRECATED';

/** Códigos informativos en reconnect (`warningCode`) o errores HTTP reales del endpoint. */
export type SocialAccountReconnectErrorCode =
  | 'META_OAUTH_REQUIRED'
  | 'META_PAGE_NOT_RETURNED_BY_META'
  | 'LINKEDIN_OAUTH_REQUIRED'
  | 'LINKEDIN_ORGANIZATION_NOT_RETURNED'
  | 'SOCIAL_ACCOUNT_NOT_FOUND'
  | 'SOCIAL_UNSUPPORTED_ACCOUNT_TYPE';

export class SocialApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'SocialApiError';
    this.status = status;
    this.code = code;
  }
}

export function isSocialApiError(error: unknown): error is SocialApiError {
  return error instanceof SocialApiError;
}

export function extractApiErrorCode(error: HttpErrorResponse): string | undefined {
  const body = error.error;
  if (!body) return undefined;

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    if (typeof first.code === 'string') return first.code;
  }

  if (typeof body.code === 'string') return body.code;

  return undefined;
}

export function toSocialApiError(
  error: HttpErrorResponse,
  defaultMessage = 'Error en la operación social'
): SocialApiError {
  const message = extractErrorMessage(error, defaultMessage);
  const code = extractApiErrorCode(error);
  return new SocialApiError(message, error.status, code);
}

export function getSocialConnectionErrorMessage(code?: string, maxConnections?: number): string {
  switch (code) {
    case 'SOCIAL_CONNECTION_LIMIT_REACHED':
      return maxConnections != null
        ? `Has alcanzado el límite de conexiones (máx. ${maxConnections}). Desconecta una antes de añadir otra.`
        : 'Has alcanzado el límite de conexiones. Desconecta una antes de añadir otra.';
    case 'SOCIAL_CONNECTION_NOT_FOUND':
      return 'La conexión ya no existe o no tienes acceso.';
    case 'SOCIAL_CONNECTION_REAUTH_REQUIRED':
      return 'Indica qué conexión deseas reautenticar.';
    case 'SOCIAL_IG_ACCOUNT_LIMIT_REACHED':
      return 'Has alcanzado el límite de cuentas Instagram activas.';
    case 'SOCIAL_CONNECTION_REAUTH_USER_MISMATCH':
      return 'Iniciaste sesión con otra cuenta de Instagram. Usa la cuenta correcta o cancela.';
    default:
      return 'Error en la operación de conexión.';
  }
}

export function getSocialInstagramConnectionErrorMessage(
  code?: string,
  status?: Pick<
    SocialConnectionTypeStatus,
    'maxConnectionsPerTenant' | 'maxInstagramAccounts'
  >
): string {
  if (code === 'SOCIAL_CONNECTION_LIMIT_REACHED') {
    return getSocialConnectionErrorMessage(code, status?.maxConnectionsPerTenant);
  }
  if (code === 'SOCIAL_IG_ACCOUNT_LIMIT_REACHED') {
    const max = status?.maxInstagramAccounts;
    return max != null
      ? `Has alcanzado el límite de cuentas Instagram activas (máx. ${max}).`
      : getSocialConnectionErrorMessage(code);
  }
  return getSocialConnectionErrorMessage(code, status?.maxConnectionsPerTenant);
}

export function getSocialThreadsConnectionErrorMessage(
  code?: string,
  status?: Pick<
    SocialConnectionTypeStatus,
    'maxConnectionsPerTenant' | 'maxThreadsAccounts'
  >
): string {
  if (code === 'SOCIAL_CONNECTION_LIMIT_REACHED') {
    const max = status?.maxConnectionsPerTenant;
    return max != null
      ? `Has alcanzado el límite de conexiones Threads (máx. ${max}).`
      : 'Has alcanzado el límite de conexiones Threads.';
  }
  if (code === 'SOCIAL_THREADS_ACCOUNT_LIMIT_REACHED') {
    const max = status?.maxThreadsAccounts;
    return max != null
      ? `Has alcanzado el límite de perfiles Threads activos (máx. ${max}).`
      : 'Has alcanzado el límite de perfiles Threads activos.';
  }
  if (code === 'SOCIAL_CONNECTION_REAUTH_USER_MISMATCH') {
    return 'Iniciaste sesión con otra cuenta de Threads. Usa la cuenta correcta o cancela.';
  }
  return getSocialConnectionErrorMessage(code, status?.maxConnectionsPerTenant);
}

export function getSocialLinkedInConnectionErrorMessage(
  code?: string,
  status?: Pick<
    SocialConnectionTypeStatus,
    'maxConnectionsPerTenant' | 'maxLinkedInOrganizations'
  >
): string {
  if (code === 'SOCIAL_CONNECTION_LIMIT_REACHED') {
    const max = status?.maxConnectionsPerTenant;
    return max != null
      ? `Has alcanzado el límite de miembros LinkedIn conectados (máx. ${max}).`
      : 'Has alcanzado el límite de miembros LinkedIn conectados.';
  }
  if (code === 'LINKEDIN_ORGANIZATION_LIMIT_REACHED') {
    const max = status?.maxLinkedInOrganizations;
    return max != null
      ? `Algunas organizaciones no se importaron por límite del plan (máx. ${max}).`
      : 'Algunas organizaciones no se importaron por límite del plan.';
  }
  if (code === 'LINKEDIN_NO_ADMIN_ORGANIZATIONS') {
    return 'Este miembro no administra organizaciones en LinkedIn.';
  }
  if (code === 'SOCIAL_CONNECTION_REAUTH_USER_MISMATCH') {
    return 'Debes iniciar sesión con la misma cuenta LinkedIn.';
  }
  if (code === 'LINKEDIN_AUTH_REVOKED') {
    return 'La sesión de LinkedIn expiró. Vuelve a conectar.';
  }
  if (code === 'SOCIAL_ACCOUNT_LIMIT_REACHED') {
    const max = status?.maxLinkedInOrganizations;
    return max != null
      ? `Has alcanzado el límite de páginas de empresa LinkedIn (máx. ${max}).`
      : 'Has alcanzado el límite de páginas de empresa LinkedIn.';
  }
  return getSocialConnectionErrorMessage(code, status?.maxConnectionsPerTenant);
}

export function getSocialAccountConnectErrorMessage(code?: string): string {
  switch (code) {
    case 'SOCIAL_ACCOUNT_LIMIT_REACHED':
      return 'Has alcanzado el límite de páginas conectadas en tu plan.';
    case 'SOCIAL_ACCOUNT_ALREADY_CONNECTED':
      return 'Esta página ya está conectada al workspace.';
    case 'SOCIAL_ACCOUNT_CONNECT_NOT_ELIGIBLE':
      return 'Esta página no se puede conectar en este momento.';
    case 'SOCIAL_ACCOUNT_STATUS_PATCH_DEPRECATED':
      return 'Usa conectar/desconectar en lugar de activar la página con el interruptor.';
    default:
      return 'No se pudo conectar la página.';
  }
}

export function getSocialDeleteErrorMessage(code?: string): string {
  switch (code) {
    case 'SOCIAL_ACCOUNT_DELETE_NOT_ELIGIBLE':
      return 'Solo puedes eliminar cuentas inactivas con token revocado.';
    case 'SOCIAL_ACCOUNT_DELETE_PENDING_PUBLICATIONS':
      return 'No se puede eliminar: hay publicaciones programadas pendientes.';
    case 'SOCIAL_ACCOUNT_DELETE_HAS_CHILD_ACCOUNTS':
      return 'No se puede eliminar: tiene cuentas Instagram vinculadas. Elimínalas primero.';
    default:
      return 'No se pudo eliminar la cuenta.';
  }
}
