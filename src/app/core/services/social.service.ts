import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { forkJoin, Observable, throwError, timer } from 'rxjs';
import { catchError, last, map, switchMap, takeWhile, tap } from 'rxjs/operators';
import {
  ApiResponse,
  CreateSocialPostPlanRequest,
  PublishAttempt,
  SocialAccount,
  SocialAccountsQuery,
  SocialAccountListStatus,
  SocialBulkConnectAccountsRequest,
  SocialConnectAccountResponse,
  SocialConnection,
  SocialConnectionAccountsResponse,
  SocialConnectionsQuery,
  SocialConnectStartOptions,
  SocialConnectionType,
  SocialConnectionTypeStatus,
  SocialIntegrationCatalogItem,
  SocialIntegrationsStatus,
  SocialProviderGroup,
  SocialProviderGroupStatus,
  SocialReconnectAccountResponse,
  SocialSyncAccountsOptions,
  SocialSyncResponse
} from '../../features/social/models/social.model';
import {
  CreatePostPlanResponse,
  PostPlanDetailsResponse,
  PostPlanListResponse
} from '../../features/scheduler/models/post-plan.model';
import { SocialApiError, toSocialApiError } from '../../shared/utils/social-api.error';

export interface SocialOAuthResult {
  success: boolean;
  connectionStatus: SocialConnectionTypeStatus;
}

export interface MetaIntegrationSnapshot {
  group: SocialProviderGroupStatus;
  facebookStatus: SocialConnectionTypeStatus;
  instagramStatus: SocialConnectionTypeStatus;
  facebookConnections: SocialConnection[];
  facebookPages: SocialAccount[];
  instagramConnections: SocialConnection[];
  instagramAccounts: SocialAccount[];
}

export interface FacebookIntegrationBundle {
  status: SocialConnectionTypeStatus;
  connections: SocialConnection[];
  pages: SocialAccount[];
}

export interface InstagramIntegrationBundle {
  status: SocialConnectionTypeStatus;
  connections: SocialConnection[];
  accounts: SocialAccount[];
}

export interface LinkedInIntegrationBundle {
  status: SocialConnectionTypeStatus;
  connections: SocialConnection[];
  organizations: SocialAccount[];
}

export interface ThreadsIntegrationBundle {
  status: SocialConnectionTypeStatus;
  connections: SocialConnection[];
  accounts: SocialAccount[];
}

export interface PollPublishAttemptsOptions {
  intervalMs?: number;
  timeoutMs?: number;
  isDone?: (attempts: PublishAttempt[]) => boolean;
}

/** Opciones de OAuth en popup (p. ej. mode=add con conexiones previas). */
export type ConnectWithPopupOptions = Pick<SocialConnectStartOptions, 'mode' | 'connectionId'>;

@Injectable({
  providedIn: 'root'
})
export class SocialService {
  private readonly socialBase = '/api/social';
  private readonly connectBase = `${this.socialBase}/connect`;
  private readonly integrationsBase = `${this.socialBase}/integrations`;
  private readonly accountsBase = `${this.socialBase}/accounts`;
  private readonly connectionsBase = `${this.socialBase}/connections`;
  private readonly postPlansBase = `${this.socialBase}/post-plans`;
  private readonly postTargetsBase = `${this.socialBase}/post-targets`;

  constructor(private http: HttpClient) {}

  startConnect(
    providerGroup: SocialProviderGroup,
    connectionType: SocialConnectionType,
    options?: SocialConnectStartOptions
  ): Observable<string> {
    let params = new HttpParams();
    if (options?.mode) {
      params = params.set('mode', options.mode);
    }
    if (options?.connectionId != null) {
      params = params.set('connectionId', String(options.connectionId));
    }

    return this.http
      .get<ApiResponse<{ authorizationUrl: string }>>(
        `${this.connectBase}/${providerGroup}/${connectionType}/start`,
        { params }
      )
      .pipe(
        map((r) => r.data.authorizationUrl),
        catchError(this.handleError)
      );
  }

  /** OAuth Facebook: redirección completa (callback 302 al selector post-OAuth). */
  startFacebookConnectRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.startConnect('meta', 'facebook_login', options).pipe(
      map((url) => {
        window.location.assign(url);
        return undefined as never;
      })
    );
  }

  /** OAuth Instagram: redirección completa (callback 302 a /cuentas-conectadas/instagram). */
  startInstagramConnectRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.startConnect('meta', 'instagram_login', options).pipe(
      map((url) => {
        window.location.assign(url);
        return undefined as never;
      })
    );
  }

  /** OAuth Threads: redirección completa (callback 302 a /cuentas-conectadas/threads). */
  startThreadsConnectRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.startConnect('meta', 'threads_login', options).pipe(
      map((url) => {
        window.location.assign(url);
        return undefined as never;
      })
    );
  }

  /** OAuth LinkedIn: redirección completa (callback 302 al selector post-OAuth). */
  startLinkedInConnectRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.startConnect('linkedin', 'linkedin_oauth', options).pipe(
      map((url) => {
        window.location.assign(url);
        return undefined as never;
      })
    );
  }

  getConnections(query: SocialConnectionsQuery = {}): Observable<SocialConnection[]> {
    let params = new HttpParams();
    if (query.providerGroup) {
      params = params.set('providerGroup', query.providerGroup);
    }
    if (query.connectionType) {
      params = params.set('connectionType', query.connectionType);
    }
    if (query.isActive !== undefined) {
      params = params.set('isActive', String(query.isActive));
    }

    return this.http
      .get<ApiResponse<SocialConnection[]>>(this.connectionsBase, { params })
      .pipe(
        map((r) => r.data ?? []),
        catchError(this.handleError)
      );
  }

  getConnection(connectionId: number): Observable<SocialConnection> {
    return this.http
      .get<ApiResponse<SocialConnection>>(`${this.connectionsBase}/${connectionId}`)
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  syncConnection(connectionId: number): Observable<SocialSyncResponse> {
    return this.http
      .post<ApiResponse<SocialSyncResponse>>(`${this.connectionsBase}/${connectionId}/sync`, {})
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  disconnectConnection(connectionId: number): Observable<{ message?: string }> {
    return this.http
      .post<ApiResponse<{ message?: string }>>(
        `${this.connectionsBase}/${connectionId}/disconnect`,
        {}
      )
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  getConnectionAccounts(
    connectionId: number,
    status: SocialAccountListStatus = 'available'
  ): Observable<SocialConnectionAccountsResponse> {
    const params = new HttpParams().set('status', status);
    return this.http
      .get<ApiResponse<SocialConnectionAccountsResponse>>(
        `${this.connectionsBase}/${connectionId}/accounts`,
        { params }
      )
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  hasActiveConnections(status: SocialConnectionTypeStatus): boolean {
    if (typeof status.connectionCount === 'number') {
      return status.connectionCount > 0;
    }
    return status.connected === true;
  }

  getConnectionCount(status: SocialConnectionTypeStatus): number {
    if (typeof status.connectionCount === 'number') {
      return status.connectionCount;
    }
    return status.connected ? 1 : 0;
  }

  getIntegrationsCatalog(): Observable<SocialIntegrationCatalogItem[]> {
    return this.http.get<ApiResponse<SocialIntegrationCatalogItem[]>>(this.integrationsBase).pipe(
      map((r) => r.data ?? []),
      catchError(this.handleError)
    );
  }

  getIntegrationsStatus(): Observable<SocialIntegrationsStatus> {
    return this.http
      .get<ApiResponse<SocialIntegrationsStatus>>(`${this.integrationsBase}/status`)
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  getProviderGroupStatus(providerGroup: SocialProviderGroup): Observable<SocialProviderGroupStatus> {
    return this.http
      .get<ApiResponse<SocialProviderGroupStatus>>(
        `${this.integrationsBase}/${providerGroup}/status`
      )
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  getConnectionTypeStatus(
    providerGroup: SocialProviderGroup,
    connectionType: SocialConnectionType
  ): Observable<SocialConnectionTypeStatus> {
    return this.http
      .get<ApiResponse<SocialConnectionTypeStatus>>(
        `${this.integrationsBase}/${providerGroup}/${connectionType}/status`
      )
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  isAccountTokenRevoked(account: SocialAccount): boolean {
    const tokenStatus = (account.tokenStatus ?? '').toLowerCase();
    return account.requiresReconnect || tokenStatus === 'revoked';
  }

  /**
   * OAuth conectado y cuentas listas. No para en sync success si hubo upserts pero activeAccounts sigue en 0.
   */
  isConnectionTypeStatusConfirmed(status: SocialConnectionTypeStatus): boolean {
    if (!this.hasActiveConnections(status)) return false;
    if ((status.activeAccounts ?? 0) > 0) return true;

    const sync = status.lastSyncStatus ?? '';
    const upserted = status.lastSyncAccountsUpserted ?? 0;

    if (sync === 'failed') return true;

    if ((sync === 'success' || sync === 'partial') && upserted > 0) {
      return false;
    }

    if (sync === 'success' || sync === 'partial') return true;

    return false;
  }

  /** Fin del poll OAuth en popup según mode y estado previo al abrir la ventana. */
  isConnectPopupConfirmed(
    status: SocialConnectionTypeStatus,
    baseline: SocialConnectionTypeStatus,
    options?: ConnectWithPopupOptions
  ): boolean {
    if (options?.mode === 'add' && this.getConnectionCount(baseline) > 0) {
      return this.getConnectionCount(status) > this.getConnectionCount(baseline);
    }

    if (options?.mode === 'reauth') {
      if (baseline.requiresReconnect && !status.requiresReconnect) return true;

      const sync = status.lastSyncStatus ?? '';
      if (
        (sync === 'success' || sync === 'partial') &&
        status.lastSyncAt &&
        status.lastSyncAt !== baseline.lastSyncAt
      ) {
        return true;
      }

      return false;
    }

    return this.isConnectionTypeStatusConfirmed(status);
  }

  isConnectPopupSuccessful(
    status: SocialConnectionTypeStatus,
    baseline: SocialConnectionTypeStatus,
    options?: ConnectWithPopupOptions
  ): boolean {
    if (options?.mode === 'add' && this.getConnectionCount(baseline) > 0) {
      return this.getConnectionCount(status) > this.getConnectionCount(baseline);
    }

    if (options?.mode === 'reauth') {
      return !status.requiresReconnect;
    }

    return this.hasActiveConnections(status);
  }

  refreshFacebookIntegrationBundle(): Observable<FacebookIntegrationBundle> {
    return forkJoin({
      status: this.getConnectionTypeStatus('meta', 'facebook_login'),
      connections: this.getConnections({
        providerGroup: 'meta',
        connectionType: 'facebook_login',
        isActive: true
      }),
      pages: this.getAccounts({
        providerGroup: 'meta',
        provider: 'facebook',
        accountType: 'page',
        status: 'connected',
        includeBindings: true
      })
    });
  }

  refreshInstagramIntegrationBundle(): Observable<InstagramIntegrationBundle> {
    return forkJoin({
      status: this.getConnectionTypeStatus('meta', 'instagram_login'),
      connections: this.getConnections({
        providerGroup: 'meta',
        connectionType: 'instagram_login',
        isActive: true
      }),
      accounts: this.getAccounts({ providerGroup: 'meta', provider: 'instagram' })
    });
  }

  refreshThreadsIntegrationBundle(): Observable<ThreadsIntegrationBundle> {
    return forkJoin({
      status: this.getConnectionTypeStatus('meta', 'threads_login'),
      connections: this.getConnections({
        providerGroup: 'meta',
        connectionType: 'threads_login',
        isActive: true
      }),
      accounts: this.getAccounts({ providerGroup: 'meta', provider: 'threads' })
    });
  }

  refreshLinkedInIntegrationBundle(): Observable<LinkedInIntegrationBundle> {
    return forkJoin({
      status: this.getConnectionTypeStatus('linkedin', 'linkedin_oauth'),
      connections: this.getConnections({
        providerGroup: 'linkedin',
        connectionType: 'linkedin_oauth',
        isActive: true
      }),
      organizations: this.getAccounts({
        providerGroup: 'linkedin',
        provider: 'linkedin',
        forPublishing: true,
        includeBindings: true
      })
    });
  }

  fetchMetaIntegrationSnapshot(): Observable<MetaIntegrationSnapshot> {
    return forkJoin({
      group: this.getProviderGroupStatus('meta'),
      facebookStatus: this.getConnectionTypeStatus('meta', 'facebook_login'),
      instagramStatus: this.getConnectionTypeStatus('meta', 'instagram_login'),
      facebookConnections: this.getConnections({
        providerGroup: 'meta',
        connectionType: 'facebook_login',
        isActive: true
      }),
      facebookPages: this.getAccounts({
        providerGroup: 'meta',
        provider: 'facebook',
        accountType: 'page',
        status: 'connected',
        includeBindings: true
      }),
      instagramConnections: this.getConnections({
        providerGroup: 'meta',
        connectionType: 'instagram_login',
        isActive: true
      }),
      instagramAccounts: this.getAccounts({ providerGroup: 'meta', provider: 'instagram' })
    });
  }

  /** Estado estable: cuentas activas visibles o sync terminal sin upserts pendientes. */
  isMetaIntegrationReady(snapshot: MetaIntegrationSnapshot): boolean {
    if ((snapshot.group.activeAccounts ?? 0) > 0) return true;
    if ((snapshot.facebookStatus.activeAccounts ?? 0) > 0) return true;
    if ((snapshot.instagramStatus.activeAccounts ?? 0) > 0) return true;

    if (snapshot.facebookPages.some((a) => a.isActive)) return true;
    if (snapshot.instagramAccounts.some((a) => a.isActive)) return true;

    for (const connection of [snapshot.facebookStatus, snapshot.instagramStatus]) {
      if (!this.hasActiveConnections(connection)) continue;

      const sync = connection.lastSyncStatus ?? '';
      const upserted = connection.lastSyncAccountsUpserted ?? 0;

      if (sync === 'failed') continue;

      if ((sync === 'success' || sync === 'partial') && upserted > 0) {
        return false;
      }

      if (sync === 'success' || sync === 'partial') continue;

      return false;
    }

    return true;
  }

  /**
   * Tras OAuth/sync, consulta status + accounts hasta que activeAccounts y listados cuadren.
   */
  pollMetaIntegrationReady(options?: {
    intervalMs?: number;
    timeoutMs?: number;
  }): Observable<MetaIntegrationSnapshot> {
    const intervalMs = options?.intervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 90000;
    const maxTicks = Math.ceil(timeoutMs / intervalMs);
    let tick = 0;

    return timer(0, intervalMs).pipe(
      switchMap(() => this.fetchMetaIntegrationSnapshot()),
      takeWhile((snapshot) => {
        tick += 1;
        if (this.isMetaIntegrationReady(snapshot)) return false;
        return tick < maxTicks;
      }, true),
      last()
    );
  }

  pollConnectionTypeStatusUntilConfirmed(
    providerGroup: SocialProviderGroup,
    connectionType: SocialConnectionType,
    options?: { intervalMs?: number; timeoutMs?: number }
  ): Observable<SocialConnectionTypeStatus> {
    const intervalMs = options?.intervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 90000;
    const maxTicks = Math.ceil(timeoutMs / intervalMs);
    let tick = 0;

    return timer(0, intervalMs).pipe(
      switchMap(() => this.getConnectionTypeStatus(providerGroup, connectionType)),
      takeWhile((status) => {
        tick += 1;
        if (this.isConnectionTypeStatusConfirmed(status)) return false;
        return tick < maxTicks;
      }, true),
      last()
    );
  }

  disconnect(
    providerGroup: SocialProviderGroup,
    connectionType: SocialConnectionType
  ): Observable<{ message?: string }> {
    return this.http
      .post<ApiResponse<{ message?: string }>>(
        `${this.integrationsBase}/${providerGroup}/${connectionType}/disconnect`,
        {}
      )
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  getAccounts(query: SocialAccountsQuery = {}): Observable<SocialAccount[]> {
    let params = new HttpParams();
    if (query.providerGroup) {
      params = params.set('providerGroup', query.providerGroup);
    }
    if (query.provider) {
      params = params.set('provider', query.provider);
    }
    if (query.accountType) {
      params = params.set('accountType', query.accountType);
    }
    if (query.forPublishing !== undefined) {
      params = params.set('forPublishing', String(query.forPublishing));
    }
    if (query.includeCapabilities !== undefined) {
      params = params.set('includeCapabilities', String(query.includeCapabilities));
    }
    if (query.includeHidden !== undefined) {
      params = params.set('includeHidden', String(query.includeHidden));
    }
    if (query.includeBindings !== undefined) {
      params = params.set('includeBindings', String(query.includeBindings));
    }
    if (query.connectionId != null) {
      params = params.set('connectionId', String(query.connectionId));
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    return this.http
      .get<ApiResponse<SocialAccount[]>>(this.accountsBase, { params })
      .pipe(
        map((r) => r.data ?? []),
        catchError(this.handleError)
      );
  }

  connectAccount(accountId: number, socialConnectionId: number): Observable<SocialConnectAccountResponse> {
    return this.http
      .post<ApiResponse<SocialConnectAccountResponse>>(`${this.accountsBase}/${accountId}/connect`, {
        socialConnectionId
      })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  connectAccountsBulk(
    managedSocialAccountIds: number[],
    socialConnectionId: number
  ): Observable<SocialAccount[]> {
    const body: SocialBulkConnectAccountsRequest = {
      managedSocialAccountIds,
      socialConnectionId
    };
    return this.http
      .post<ApiResponse<SocialAccount[]>>(`${this.accountsBase}/connect`, body)
      .pipe(
        map((r) => r.data ?? []),
        catchError(this.handleError)
      );
  }

  disconnectAccountFromWorkspace(
    accountId: number,
    socialConnectionId: number
  ): Observable<SocialAccount> {
    return this.http
      .post<ApiResponse<SocialAccount>>(`${this.accountsBase}/${accountId}/disconnect`, {
        socialConnectionId
      })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  updateAccountStatus(accountId: number, isActive: boolean): Observable<SocialAccount> {
    return this.http
      .patch<ApiResponse<SocialAccount>>(`${this.accountsBase}/${accountId}/status`, { isActive })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  syncAccounts(options?: SocialSyncAccountsOptions): Observable<SocialSyncResponse> {
    let params = new HttpParams();
    if (options?.providerGroup) {
      params = params.set('providerGroup', options.providerGroup);
    }
    if (options?.connectionType) {
      params = params.set('connectionType', options.connectionType);
    }
    if (options?.connectionId != null) {
      params = params.set('connectionId', String(options.connectionId));
    }

    return this.http
      .post<ApiResponse<SocialSyncResponse>>(`${this.accountsBase}/sync`, {}, { params })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  validateAccount(accountId: number): Observable<SocialAccount> {
    return this.http
      .post<ApiResponse<SocialAccount>>(`${this.accountsBase}/${accountId}/validate`, {})
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  reconnectAccount(accountId: number): Observable<SocialReconnectAccountResponse> {
    return this.http
      .post<ApiResponse<SocialReconnectAccountResponse>>(`${this.accountsBase}/${accountId}/reconnect`, {})
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  setAccountVisibility(accountId: number, hidden: boolean): Observable<SocialAccount> {
    return this.http
      .patch<ApiResponse<SocialAccount>>(`${this.accountsBase}/${accountId}/visibility`, { hidden })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError)
      );
  }

  deleteAccount(accountId: number): Observable<void> {
    return this.http.delete<void>(`${this.accountsBase}/${accountId}`, { observe: 'body' }).pipe(
      map(() => undefined),
      catchError(this.handleError)
    );
  }

  createPostPlan(request: CreateSocialPostPlanRequest): Observable<CreatePostPlanResponse> {
    return this.http.post<CreatePostPlanResponse>(this.postPlansBase, request).pipe(
      catchError(this.handleError)
    );
  }

  getPostPlans(
    start: Date,
    end: Date,
    status?: string,
    onlyWithPublishableTargets?: boolean,
    q?: string
  ): Observable<PostPlanListResponse> {
    const fromDate = this.formatDateToYYYYMMDD(start);
    const toDate = this.formatDateToYYYYMMDD(end);

    let params = new HttpParams().set('from', fromDate).set('to', toDate);

    if (status) {
      params = params.set('status', status);
    }
    if (onlyWithPublishableTargets !== undefined) {
      params = params.set('onlyWithPublishableTargets', onlyWithPublishableTargets.toString());
    }
    if (q) {
      params = params.set('q', q);
    }

    return this.http.get<PostPlanListResponse>(this.postPlansBase, { params }).pipe(
      catchError(this.handleError)
    );
  }

  getPostPlanDetails(planId: number): Observable<PostPlanDetailsResponse> {
    return this.http.get<PostPlanDetailsResponse>(`${this.postPlansBase}/${planId}`).pipe(
      catchError(this.handleError)
    );
  }

  getPublishAttempts(postTargetId: number): Observable<PublishAttempt[]> {
    return this.http
      .get<ApiResponse<PublishAttempt[]>>(
        `${this.postTargetsBase}/${postTargetId}/publish-attempts`
      )
      .pipe(
        map((r) => r.data ?? []),
        catchError(this.handleError)
      );
  }

  pollPublishAttempts(
    postTargetId: number,
    options: PollPublishAttemptsOptions = {}
  ): Observable<PublishAttempt[]> {
    const intervalMs = options.intervalMs ?? 4000;
    const timeoutMs = options.timeoutMs ?? 300000;
    const isDone =
      options.isDone ??
      ((attempts) => {
        const latest = attempts[attempts.length - 1];
        if (!latest) return false;
        return latest.status === 'success' || latest.status === 'failed';
      });

    const maxTicks = Math.ceil(timeoutMs / intervalMs);
    let tick = 0;

    return timer(0, intervalMs).pipe(
      switchMap(() => this.getPublishAttempts(postTargetId)),
      takeWhile((attempts) => {
        tick += 1;
        if (isDone(attempts)) {
          return false;
        }
        return tick < maxTicks;
      }, true),
      last(),
      map((attempts) => attempts ?? [])
    );
  }

  connectWithPopup(
    providerGroup: SocialProviderGroup,
    connectionType: SocialConnectionType,
    startUrl$: Observable<string>,
    options?: ConnectWithPopupOptions
  ): Observable<SocialOAuthResult> {
    const intervalMs = 2000;
    const timeoutMs = 90000;
    const maxTicks = Math.ceil(timeoutMs / intervalMs);

    return this.getConnectionTypeStatus(providerGroup, connectionType).pipe(
      switchMap((baselineStatus) =>
        startUrl$.pipe(
          switchMap((url) => {
            const popup = window.open(url, 'social_oauth', 'width=600,height=700,scrollbars=yes');
            if (!popup) {
              return throwError(
                () =>
                  new Error(
                    'No se pudo abrir la ventana de autorización. Permite popups para este sitio.'
                  )
              );
            }

            let tick = 0;

            return timer(0, intervalMs).pipe(
              switchMap(() => this.getConnectionTypeStatus(providerGroup, connectionType)),
              tap((status) => {
                if (this.isConnectPopupConfirmed(status, baselineStatus, options) && !popup.closed) {
                  popup.close();
                }
              }),
              takeWhile((status) => {
                tick += 1;
                if (this.isConnectPopupConfirmed(status, baselineStatus, options)) return false;
                if (tick >= maxTicks) return false;
                if (
                  popup.closed &&
                  !this.isConnectPopupConfirmed(status, baselineStatus, options)
                ) {
                  return false;
                }
                return true;
              }, true),
              last(),
              map((connectionStatus) => ({
                success: this.isConnectPopupSuccessful(connectionStatus, baselineStatus, options),
                connectionStatus
              })),
              catchError((err) => {
                if (!popup.closed) {
                  popup.close();
                }
                return throwError(() => err);
              })
            );
          })
        )
      )
    );
  }

  /** Maps SocialAccount to legacy FacebookPage shape for gradual migration */
  accountToFacebookPage(account: SocialAccount): import('../../features/facebook/models/facebook.model').FacebookPage {
    return {
      facebookPageId: account.externalAccountId,
      name: account.displayName,
      pictureUrl: account.pictureUrl ?? '',
      isActive: account.isActive,
      tasks: [],
      canPublish: account.canPublish,
      canOnlyAnalyze: !account.canPublish,
      tokenStatus: 0,
      lastValidatedAt: ''
    };
  }

  private formatDateToYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    return throwError(() => toSocialApiError(error));
  }
}
