export type SocialProviderGroup = 'meta' | 'linkedin' | 'google' | 'tiktok' | 'x' | 'pinterest';
export type SocialConnectionType = 'facebook_login' | 'instagram_login' | 'linkedin_oauth';
export type SocialProvider = 'facebook' | 'instagram' | 'linkedin';
export type InstagramContentType = 'image' | 'carousel' | 'video' | 'reel' | 'reels';
export type PlanMediaRole = 'primary' | 'carousel_item' | 'cover';

export interface ApiResponse<T> {
  data: T;
  requiresReauth?: boolean;
}

export interface SocialConnectResponse {
  authorizationUrl: string;
}

export interface SocialCallbackResponse {
  connectionId?: number;
  accountsImported: number;
  errors: number;
  warningCode?: string | null;
  message?: string;
}

export type SocialWorkspaceAccountStatus = 'Discovered' | 'Connected' | 'Disabled' | 'Revoked';

export type SocialRuntimeAccountStatus = SocialWorkspaceAccountStatus | 'Available' | 'LimitBlocked';

export type SocialAccountListStatus = 'available' | 'connected' | 'disabled' | 'all';

export interface SocialIntegrationCatalogItem {
  providerGroup: SocialProviderGroup;
  connectionType: SocialConnectionType;
  displayName: string;
  connected: boolean;
}

export interface SocialIntegrationsStatus {
  providerGroups: SocialProviderGroupStatus[];
}

export interface SocialProviderGroupStatus {
  providerGroup: SocialProviderGroup;
  connected: boolean;
  totalAccounts: number;
  activeAccounts: number;
  canPublishAccounts: number;
  minPublishingQuotaRemaining?: number;
}

export interface SocialConnectionTypeStatus {
  providerGroup: SocialProviderGroup;
  connectionType: SocialConnectionType;
  connected: boolean;
  connectionId?: number;
  tokenStatus?: string;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  /** Registros en BD (activas + inactivas) del flujo. */
  totalAccounts: number;
  /** Cuentas usables ahora (activas con token). */
  activeAccounts: number;
  /** Cuentas históricas revocadas/inactivas. */
  inactiveAccounts: number;
  /** Cuentas upsertadas en el último sync. */
  lastSyncAccountsUpserted?: number;
  /** Hay cuentas viejas sin token (aviso aparte). */
  hasInactiveAccounts: boolean;
  warningCode?: string | null;
  warningMessage?: string | null;
  /** Solo si falla el token OAuth de la conexión (no por cuentas inactivas). */
  requiresReconnect: boolean;
  /** Número de conexiones OAuth activas (multi-OAuth facebook_login). */
  connectionCount?: number;
  allowMultipleConnectionsPerTenant?: boolean;
  maxConnectionsPerTenant?: number;
  syncInProgress?: boolean;
  accountsReady?: boolean;
  /** Cupos OAuth restantes (multi-OAuth instagram_login). */
  remainingConnections?: number;
  /** Límite comercial de cuentas IG activas. */
  maxInstagramAccounts?: number;
  activeInstagramAccounts?: number;
  remainingInstagramAccounts?: number;
}

export interface SocialConnection {
  id: number;
  providerGroup: SocialProviderGroup;
  connectionType: SocialConnectionType;
  externalUserId: string;
  /** Nombre legible del usuario Meta (multi-OAuth). */
  displayLabel?: string;
  displayPictureUrl?: string;
  isActive: boolean;
  tokenStatus: string;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncError?: string;
  activeAccountCount: number;
  totalAccountCount: number;
  availableAccountCount?: number;
  requiresReconnect?: boolean;
}

export interface SocialConnectionAccountsResponse {
  connection: SocialConnection;
  remainingSlots: number;
  maxSlots: number;
  activeSlotsUsed: number;
  accounts: SocialSelectorAccount[];
}

export interface SocialSelectorAccount extends SocialAccount {
  workspaceStatus?: SocialWorkspaceAccountStatus;
  status?: SocialRuntimeAccountStatus;
  canConnect?: boolean;
  canConnectReason?: string | null;
  connectionBindingsCount?: number;
}

export interface SocialConnectAccountRequest {
  socialConnectionId: number;
}

/** Respuesta 200 de POST /api/social/accounts/{id}/connect */
export interface SocialConnectAccountResponse {
  accountId: number;
  status?: SocialRuntimeAccountStatus | 'Connected';
  isActive?: boolean;
  remainingSlots?: number;
  message?: string;
}

export interface SocialBulkConnectAccountsRequest {
  managedSocialAccountIds: number[];
  socialConnectionId: number;
}

export interface SocialDisconnectAccountRequest {
  socialConnectionId: number;
}

export interface SocialAccountConnectionBinding {
  socialConnectionId: number;
  isActive: boolean;
  tokenStatus: string;
  lastSyncAt?: string;
}

export interface SocialConnectStartOptions {
  mode?: 'add' | 'reauth';
  connectionId?: number;
}

export interface SocialConnectionsQuery {
  providerGroup?: SocialProviderGroup;
  connectionType?: SocialConnectionType;
  isActive?: boolean;
}

export interface SocialSyncAccountsOptions {
  providerGroup?: SocialProviderGroup;
  connectionType?: SocialConnectionType;
  connectionId?: number;
}

export interface SocialCapabilities {
  canPublishImage: boolean;
  canPublishCarousel: boolean;
  canPublishVideo: boolean;
  canPublishReels: boolean;
}

export interface PublishingQuota {
  quotaUsage?: number;
  quotaTotal: number;
  quotaDurationSeconds?: number;
  remaining: number;
  canPublish: boolean;
  queriedAt?: string;
}

export interface SocialAccount {
  id: number;
  providerGroup: SocialProviderGroup;
  provider: SocialProvider;
  accountType: string;
  externalAccountId: string;
  displayName: string;
  pictureUrl?: string;
  connectionType: SocialConnectionType;
  isActive: boolean;
  canPublish: boolean;
  tokenStatus: string;
  requiresReconnect: boolean;
  /** Oculta de GET /accounts (default). Reconnect/sync la vuelve visible. */
  isHiddenFromList?: boolean;
  /** Conexión primaria denormalizada (multi-OAuth). */
  socialConnectionId?: number;
  /** Bindings página↔conexión si includeBindings=true. */
  connectionBindings?: SocialAccountConnectionBinding[];
  capabilities?: SocialCapabilities;
  capabilitiesStale?: boolean;
  publishingQuota?: PublishingQuota;
}

export type SocialReconnectOutcome = 'success' | 'oauth_required';

/** Respuesta 200 de POST /api/social/accounts/{id}/reconnect */
export interface SocialReconnectAccountResponse {
  outcome: SocialReconnectOutcome;
  message: string;
  account?: SocialAccount;
  authorizationUrl?: string;
  recoverAccountId?: number;
  recoverDisplayName?: string;
  warningCode?: string;
}

export interface SocialAccountsQuery {
  providerGroup?: SocialProviderGroup;
  provider?: SocialProvider;
  accountType?: string;
  forPublishing?: boolean;
  includeCapabilities?: boolean;
  /** Por defecto false: excluye cuentas con isHiddenFromList. */
  includeHidden?: boolean;
  /** Incluye connectionBindings en cuentas (páginas compartidas). */
  includeBindings?: boolean;
  connectionId?: number;
  status?: SocialAccountListStatus;
}

/** @deprecated Use includeCapabilities instead of includeQuota */
export interface MetaAccountsQuery extends SocialAccountsQuery {
  includeQuota?: boolean;
}

export interface SocialSyncResponse {
  accountsImported?: number;
  errors?: number;
  message?: string;
  connectionStatus?: SocialConnectionTypeStatus;
}

export interface PlanMediaItem {
  composerMediaId: number;
  sortOrder: number;
  mediaRole: PlanMediaRole;
}

export interface PostDestination {
  managedSocialAccountId: number;
}

export interface ProviderOptionsInstagram {
  contentType: 'image' | 'carousel' | 'video' | 'reel';
  publishAsReels?: boolean;
}

export interface ProviderOptionsLinkedIn {
  articleTitle?: string;
  articleDescription?: string;
}

export interface CreateSocialPostPlanRequest {
  scheduledAt: string;
  timezone: string;
  message: string;
  linkUrl?: string;
  imageUrl?: string;
  dedupeKey?: string;
  destinations?: PostDestination[];
  planMedia?: PlanMediaItem[];
  providerOptions?: {
    instagram?: ProviderOptionsInstagram;
    linkedin?: ProviderOptionsLinkedIn;
  };
}

export type CarouselChildStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR';

export interface CarouselChildAttempt {
  composerMediaId: number;
  sortOrder: number;
  mimeType: string;
  containerId?: string;
  status: CarouselChildStatus;
}

export interface PublishAttempt {
  id: number;
  attemptNumber: number;
  phase?: string;
  creationContainerId?: string;
  containerStatus?: string;
  publishedExternalId?: string;
  status: string;
  lastAttemptAt?: string;
  errorCode?: string | null;
  errorUserMessage?: string | null;
  carouselChildren?: CarouselChildAttempt[];
}

export type ExtendedPostTargetStatus =
  | 'Pending'
  | 'Publishing'
  | 'Published'
  | 'Failed'
  | 'RetryPending'
  | 'Skipped'
  | 'Cancelled';

/** @deprecated Use SocialConnectionTypeStatus + SocialProviderGroupStatus */
export interface MetaConnectionInfo {
  connected: boolean;
  requiresReconnect: boolean;
}

/** @deprecated Use SocialProviderGroupStatus + SocialConnectionTypeStatus */
export interface MetaStatus {
  connections: {
    facebookLogin: MetaConnectionInfo;
    instagramLogin: MetaConnectionInfo;
  };
  accounts: {
    instagram: {
      total: number;
      active: number;
      canPublish: number;
      requiresReconnect: number;
      minPublishingQuotaRemaining?: number;
    };
  };
}

/** Alias for backward compatibility */
export type MetaManagedAccount = SocialAccount;
export type MetaConnectionType = SocialConnectionType;
export type MetaProvider = SocialProvider;
export type MetaCapabilities = SocialCapabilities;
export type MetaSyncResponse = SocialSyncResponse;
export type MetaDisconnectResponse = { message?: string };
export type MetaOAuthStartResponse = SocialConnectResponse;
