import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  MetaAccountsQuery,
  MetaConnectionType,
  MetaDisconnectResponse,
  MetaManagedAccount,
  MetaStatus,
  MetaSyncResponse,
  SocialConnectStartOptions,
  SocialConnection,
  SocialSyncAccountsOptions
} from '../../features/social/models/social.model';
import { SocialOAuthResult, SocialService } from './social.service';

export type MetaOAuthResult = SocialOAuthResult & { status: MetaStatus };

/**
 * @deprecated Use SocialService directly. Facade for backward compatibility.
 */
@Injectable({
  providedIn: 'root'
})
export class MetaConnectService {
  constructor(private social: SocialService) {}

  startFacebookConnect(options?: SocialConnectStartOptions): Observable<string> {
    return this.social.startConnect('meta', 'facebook_login', options);
  }

  startInstagramConnect(options?: SocialConnectStartOptions): Observable<string> {
    return this.social.startConnect('meta', 'instagram_login', options);
  }

  getStatus(): Observable<MetaStatus> {
    return this.social.getProviderGroupStatus('meta').pipe(
      map((group) => this.buildLegacyMetaStatus(group))
    );
  }

  getProviderGroupStatus() {
    return this.social.getProviderGroupStatus('meta');
  }

  getConnectionTypeStatus(connectionType: MetaConnectionType) {
    return this.social.getConnectionTypeStatus('meta', connectionType);
  }

  getAccounts(query: MetaAccountsQuery = {}): Observable<MetaManagedAccount[]> {
    const socialQuery = {
      providerGroup: 'meta' as const,
      provider: query.provider,
      forPublishing: query.forPublishing,
      includeCapabilities: query.includeQuota ?? query.includeCapabilities
    };
    return this.social.getAccounts(socialQuery);
  }

  updateAccountStatus(accountId: number, isActive: boolean): Observable<MetaManagedAccount> {
    return this.social.updateAccountStatus(accountId, isActive);
  }

  syncAccounts(options?: SocialSyncAccountsOptions): Observable<MetaSyncResponse> {
    return this.social.syncAccounts(options);
  }

  getFacebookConnections(): Observable<SocialConnection[]> {
    return this.social.getConnections({
      providerGroup: 'meta',
      connectionType: 'facebook_login',
      isActive: true
    });
  }

  getInstagramConnections(): Observable<SocialConnection[]> {
    return this.social.getConnections({
      providerGroup: 'meta',
      connectionType: 'instagram_login',
      isActive: true
    });
  }

  syncFacebookConnection(connectionId: number): Observable<MetaSyncResponse> {
    return this.social.syncConnection(connectionId);
  }

  syncInstagramConnection(connectionId: number): Observable<MetaSyncResponse> {
    return this.social.syncConnection(connectionId);
  }

  disconnectFacebookConnection(connectionId: number): Observable<MetaDisconnectResponse> {
    return this.social.disconnectConnection(connectionId);
  }

  disconnectInstagramConnection(connectionId: number): Observable<MetaDisconnectResponse> {
    return this.social.disconnectConnection(connectionId);
  }

  connectFacebookWithRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.social.startFacebookConnectRedirect(options);
  }

  connectInstagramWithRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.social.startInstagramConnectRedirect(options);
  }

  reauthFacebookConnection(connectionId: number): Observable<never> {
    return this.social.startFacebookConnectRedirect({ mode: 'reauth', connectionId });
  }

  reauthInstagramConnection(connectionId: number): Observable<never> {
    return this.social.startInstagramConnectRedirect({ mode: 'reauth', connectionId });
  }

  disconnect(connectionType: MetaConnectionType): Observable<MetaDisconnectResponse> {
    return this.social.disconnect('meta', connectionType);
  }

  connectWithPopup(
    connectionType: MetaConnectionType,
    startUrl$: Observable<string>,
    options?: SocialConnectStartOptions
  ): Observable<MetaOAuthResult> {
    return this.social.connectWithPopup('meta', connectionType, startUrl$, options).pipe(
      map((result) => ({
        success: result.success,
        connectionStatus: result.connectionStatus,
        status: this.buildLegacyMetaStatusFromConnection(result.connectionStatus)
      }))
    );
  }

  connectFacebookWithPopup(options?: SocialConnectStartOptions): Observable<MetaOAuthResult> {
    return this.connectWithPopup(
      'facebook_login',
      this.startFacebookConnect(options),
      options
    );
  }

  connectInstagramWithPopup(options?: SocialConnectStartOptions): Observable<MetaOAuthResult> {
    return this.connectWithPopup(
      'instagram_login',
      this.startInstagramConnect(options),
      options
    );
  }

  private buildLegacyMetaStatus(
    group: import('../../features/social/models/social.model').SocialProviderGroupStatus
  ): MetaStatus {
    return {
      connections: {
        facebookLogin: { connected: group.connected, requiresReconnect: false },
        instagramLogin: { connected: group.connected, requiresReconnect: false }
      },
      accounts: {
        instagram: {
          total: group.totalAccounts,
          active: group.activeAccounts,
          canPublish: group.canPublishAccounts,
          requiresReconnect: 0,
          minPublishingQuotaRemaining: group.minPublishingQuotaRemaining
        }
      }
    };
  }

  private buildLegacyMetaStatusFromConnection(
    conn: import('../../features/social/models/social.model').SocialConnectionTypeStatus
  ): MetaStatus {
    const fb = conn.connectionType === 'facebook_login';
    return {
      connections: {
        facebookLogin: {
          connected: fb ? this.social.hasActiveConnections(conn) : false,
          requiresReconnect: fb ? conn.requiresReconnect : false
        },
        instagramLogin: {
          connected: !fb ? this.social.hasActiveConnections(conn) : false,
          requiresReconnect: !fb ? conn.requiresReconnect : false
        }
      },
      accounts: {
        instagram: {
          total: 0,
          active: 0,
          canPublish: 0,
          requiresReconnect: 0
        }
      }
    };
  }
}
