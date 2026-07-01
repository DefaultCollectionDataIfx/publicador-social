/**
 * Modelos para la gestión de Colecciones
 */

/**
 * Tipo de activo social
 */
export type AssetType = 'page' | 'group';

/**
 * Proveedor del activo social
 */
export type Provider = 'facebook' | 'instagram' | 'twitter';

/**
 * Item de activo social dentro de una colección
 */
export interface SegmentItem {
  socialAssetId: number;
  assetType: AssetType;
  provider: Provider;
  providerAssetId: string;
  name: string;
  pictureUrl?: string;
  isConnected: boolean;
}

/**
 * Request para crear una colección
 */
export interface CreateSegmentRequest {
  name: string;
  description?: string;
}

/**
 * Datos de una colección en la respuesta de creación
 */
export interface CollectionData {
  collectionId: number;
  name: string;
  description?: string;
  totalItems: number;
  createdAt: string;
}

/**
 * Metadatos de paginación en respuestas de la API
 */
export interface ResponseMeta {
  totalCount: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviusPage: boolean;
  nextPageUrl?: string;
  previusPageUrl?: string;
}

/**
 * Response al crear una colección (estructura completa de la API)
 */
export interface CreateCollectionApiResponse {
  data: CollectionData;
  meta: ResponseMeta;
}

/**
 * Response al crear una colección (usa directamente CollectionData)
 */
export interface CreateSegmentResponse {
  collectionId: number;
  name: string;
  description?: string;
  totalItems: number;
  createdAt: string;
}

/**
 * Item de colección en la lista (sin items detallados)
 */
export interface CollectionListItem {
  collectionId: number;
  name: string;
  totalItems: number;
  pages?: number;
  groups?: number;
  updatedAt: string;
}

/**
 * Response de la API al listar colecciones
 */
export interface ListCollectionsApiResponse {
  data: CollectionListItem[];
  meta: ResponseMeta;
}

/**
 * Colección en la lista (sin items detallados) - alias para compatibilidad
 */
export interface SegmentListItem extends CollectionListItem {}

/**
 * Detalle completo de una colección
 */
export interface SegmentDetail {
  collectionId: number;
  name: string;
  description?: string;
  items?: SegmentItem[];
}

/**
 * Response de la API al obtener el detalle de una colección
 */
export interface GetCollectionDetailApiResponse {
  data: SegmentDetail;
  meta: ResponseMeta;
}

/**
 * Request para actualizar una colección
 */
export interface UpdateSegmentRequest {
  name?: string;
  description?: string;
  isArchived?: boolean;
}

/**
 * Request para archivar/desarchivar una colección
 */
export interface ArchiveSegmentRequest {
  isArchived: boolean;
}

/**
 * Request para agregar items a una colección (bulk)
 * 
 * Este endpoint permite agregar múltiples páginas y grupos de Facebook a una colección
 * en una sola operación.
 * 
 * Los IDs deben ser mayores que 0 y corresponder a páginas o grupos existentes
 * que pertenezcan al usuario autenticado. Si un activo ya está en la colección,
 * se omite automáticamente (no se duplica).
 */
export interface AddItemsToSegmentRequest {
  managedSocialAccountIds: number[];
}

/** @deprecated Use managedSocialAccountIds */
export interface LegacyAddItemsToSegmentRequest {
  pageIds?: number[];
  groupIds?: number[];
}

/**
 * Response al agregar items a una colección
 */
export interface AddItemsToSegmentResponse {
  collectionId: number;
  added: number;
  skippedDuplicates: number;
}

/**
 * Response de la API al agregar items a una colección
 */
export interface AddItemsToSegmentApiResponse {
  data: AddItemsToSegmentResponse;
  meta: ResponseMeta;
}

/**
 * Request para reemplazar items de una colección
 */
export interface ReplaceSegmentItemsRequest {
  managedSocialAccountIds: number[];
}

/**
 * Request para resolver targets por colecciones
 */
export interface ResolveTargetsRequest {
  collectionIds: number[];
  includeDisconnected?: boolean;
}

/**
 * Target resuelto
 */
export interface ResolvedTarget {
  socialAssetId: number;
  assetType: AssetType;
  provider: Provider;
  providerAssetId: string;
  name: string;
  pictureUrl?: string;
  isConnected: boolean;
}

/**
 * Response al resolver targets
 */
export interface ResolveTargetsResponse {
  total: number;
  pages: number;
  groups: number;
  targets: ResolvedTarget[];
}
