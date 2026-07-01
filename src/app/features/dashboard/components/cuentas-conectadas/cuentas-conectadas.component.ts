import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FacebookOAuthService } from '../../../../core/services/facebook-oauth.service';
import { MetaConnectService } from '../../../../core/services/meta-connect.service';
import { SocialService, MetaIntegrationSnapshot } from '../../../../core/services/social.service';
import {
  isSocialApiError,
  getSocialDeleteErrorMessage,
  getSocialConnectionErrorMessage,
  getSocialAccountConnectErrorMessage,
  getSocialInstagramConnectionErrorMessage
} from '../../../../shared/utils/social-api.error';
import { TenantEntitlementsResponse } from '../../../../core/models/tenant.model';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import { canUseLimit, getLimitValue, isFeatureEnabled } from '../../../../core/utils/entitlements.utils';
import { MetaConnectComponent } from '../../../../shared/components/meta-connect/meta-connect.component';
import { FacebookGroupsService } from '../../../facebook/services/facebook-groups.service';
import { FacebookPage, FacebookGroup } from '../../../facebook/models/facebook.model';
import { MetaManagedAccount } from '../../../meta/models/meta.model';
import {
  SocialAccount,
  SocialConnection,
  SocialConnectionType,
  SocialConnectionTypeStatus,
  SocialProviderGroupStatus,
  SocialReconnectAccountResponse
} from '../../../social/models/social.model';

@Component({
  selector: 'app-cuentas-conectadas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MetaConnectComponent],
  templateUrl: './cuentas-conectadas.component.html',
  styleUrl: './cuentas-conectadas.component.scss'
})
export class CuentasConectadasComponent implements OnInit {
  pages: FacebookPage[] = [];
  groups: FacebookGroup[] = [];
  loading = true;
  loadingGroups = false;
  error: string | null = null;
  groupsError: string | null = null;
  entitlements: TenantEntitlementsResponse['data'] | null = null;
  entitlementsLoading = false;
  entitlementsError: string | null = null;
  imageErrors: Set<string> = new Set();
  groupImageErrors: Set<number> = new Set();
  updatingStatus: Set<string> = new Set();
  updatingGroupStatus: Set<string> = new Set();

  metaGroupStatus: SocialProviderGroupStatus | null = null;
  facebookConnectionStatus: SocialConnectionTypeStatus | null = null;
  instagramConnectionStatus: SocialConnectionTypeStatus | null = null;
  metaStatusLoading = false;
  metaStatusError: string | null = null;
  instagramAccounts: MetaManagedAccount[] = [];
  loadingInstagram = false;
  instagramError: string | null = null;
  updatingInstagramStatus: Set<number> = new Set();
  reconnectingAccountIds: Set<number> = new Set();
  hidingAccountIds: Set<number> = new Set();
  deletingAccountIds: Set<number> = new Set();
  syncingMeta = false;
  confirmingConnection: SocialConnectionType | null = null;
  disconnectingMeta: 'facebook_login' | 'instagram_login' | null = null;
  facebookConnections: SocialConnection[] = [];
  loadingFacebookConnections = false;
  syncingConnectionIds = new Set<number>();
  disconnectingConnectionIds = new Set<number>();
  reauthingConnectionIds = new Set<number>();
  // Formulario para agregar grupo
  showAddGroupForm = false;
  groupUrl = '';
  addingGroup = false;
  pagesConnectedToast: string | null = null;
  igOAuthToast: string | null = null;
  igOAuthError: string | null = null;
  instagramConnections: SocialConnection[] = [];
  loadingInstagramConnections = false;

  private facebookAccountByExternalId = new Map<string, SocialAccount>();

  private isAccountTokenRevoked(account: SocialAccount): boolean {
    return this.social.isAccountTokenRevoked(account);
  }

  getFacebookAccount(page: FacebookPage): SocialAccount | undefined {
    return this.facebookAccountByExternalId.get(page.facebookPageId);
  }

  constructor(
    private facebookService: FacebookOAuthService,
    private metaConnect: MetaConnectService,
    private social: SocialService,
    private groupsService: FacebookGroupsService,
    private tenantEntitlements: TenantEntitlementsService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.normalizeCanonicalRoute();

    this.route.queryParamMap.subscribe((params) => {
      this.handleOAuthQueryParams(params);
    });

    this.loadConnectedPages();
    this.loadGroups();
    this.loadFacebookConnections();
    this.loadMetaStatus();
    this.loadInstagramConnections();
    this.loadInstagramAccounts();
    this.refreshEntitlements();
  }

  /** Rutas alias (/facebook, /instagram) cargan la misma vista unificada en /cuentas-conectadas. */
  private normalizeCanonicalRoute(): void {
    const path = this.router.url.split('?')[0];
    if (
      path.endsWith('/cuentas-conectadas/facebook') ||
      path.endsWith('/cuentas-conectadas/instagram')
    ) {
      void this.router.navigate(['/dashboard/cuentas-conectadas'], {
        queryParams: this.route.snapshot.queryParams,
        replaceUrl: true
      });
    }
  }

  private handleOAuthQueryParams(params: import('@angular/router').ParamMap): void {
    const connected = params.get('pagesConnected');
    if (connected != null && connected !== '') {
      const count = Number(connected);
      if (Number.isFinite(count) && count > 0) {
        this.pagesConnectedToast = `${count} página${count === 1 ? '' : 's'} conectada${count === 1 ? '' : 's'} al workspace.`;
      }
    } else {
      this.pagesConnectedToast = null;
    }

    const igError = params.get('igError');
    if (igError) {
      this.igOAuthError = getSocialInstagramConnectionErrorMessage(
        igError,
        this.instagramConnectionStatus ?? undefined
      );
    } else {
      this.igOAuthError = null;
    }

    const connectionId = params.get('connectionId');
    const accountsImported = params.get('accountsImported');
    if (connectionId && !accountsImported && !params.get('warning') && !params.get('fbError')) {
      this.igOAuthToast = 'Cliente Instagram conectado correctamente.';
      this.refreshInstagramIntegration();
      void this.router.navigate(['/dashboard/cuentas-conectadas'], {
        queryParams: {},
        replaceUrl: true
      });
    }
  }

  private refreshEntitlements(): void {
    this.entitlementsLoading = true;
    this.entitlementsError = null;

    this.tenantEntitlements.refreshCurrentEntitlements().subscribe((data) => {
      this.entitlements = data;
      this.entitlementsLoading = false;
    });
  }

  private refreshEntitlementsSilently(): void {
    this.tenantEntitlements.refreshCurrentEntitlements().subscribe((data) => {
      this.entitlements = data;
    });
  }

  private refreshEntitlementsAndReloadLists(): void {
    this.refreshEntitlements();
    this.loadConnectedPages();
    this.loadGroups();
  }

  private getIntegrationLimit(): number | null | undefined {
    return getLimitValue(this.entitlements?.limits, ['limit.integrations']);
  }

  private getFacebookPagesLimit(): number | null | undefined {
    return getLimitValue(this.entitlements?.limits, ['limit.facebook.pages']);
  }

  private getFacebookGroupsLimit(): number | null | undefined {
    return getLimitValue(this.entitlements?.limits, ['limit.facebook.groups']);
  }

  private getCurrentFacebookIntegrationUsage(): number {
    if (!this.entitlements) return 0;
    return (this.entitlements.currentUsage.facebookPages ?? 0) + (this.entitlements.currentUsage.facebookGroups ?? 0);
  }

  private getCurrentFacebookPagesUsage(): number {
    if (!this.entitlements) return 0;
    return this.entitlements.currentUsage.facebookPages ?? 0;
  }

  private getCurrentFacebookGroupsUsage(): number {
    if (!this.entitlements) return 0;
    return this.entitlements.currentUsage.facebookGroups ?? 0;
  }

  isPageActivationAllowed(page: FacebookPage): boolean {
    // Desactivar siempre permitido; el enforcement estricto aplica al activar/crear.
    if (page.isActive) return true;

    const account = this.getFacebookAccount(page);
    if (account && this.isAccountTokenRevoked(account)) return false;

    if (!this.entitlements) return true; // sin entitlements cargados: no bloquear para no romper UX

    if (!isFeatureEnabled(this.entitlements.features, 'network.facebook.pages')) return false;

    const pageLimit = this.getFacebookPagesLimit();
    if (!canUseLimit(this.getCurrentFacebookPagesUsage(), pageLimit, 1)) return false;

    const integrationsLimit = this.getIntegrationLimit();
    if (!canUseLimit(this.getCurrentFacebookIntegrationUsage(), integrationsLimit, 1)) return false;

    return true;
  }

  isGroupActivationAllowed(group: FacebookGroup): boolean {
    if (group.isActive) return true;
    if (!this.entitlements) return true;

    if (!isFeatureEnabled(this.entitlements.features, 'network.facebook.groups')) return false;

    const groupLimit = this.getFacebookGroupsLimit();
    if (!canUseLimit(this.getCurrentFacebookGroupsUsage(), groupLimit, 1)) return false;

    const integrationsLimit = this.getIntegrationLimit();
    if (!canUseLimit(this.getCurrentFacebookIntegrationUsage(), integrationsLimit, 1)) return false;

    return true;
  }

  getPageActivationGateReason(page: FacebookPage): string | null {
    if (page.isActive) return null;

    const account = this.getFacebookAccount(page);
    if (account && this.isAccountTokenRevoked(account)) {
      return 'Token revocado. Sincroniza Meta o reconecta Facebook; solo activar la página no restaura el page access token.';
    }

    if (!this.entitlements) return null;

    if (!isFeatureEnabled(this.entitlements.features, 'network.facebook.pages')) {
      return 'Tu plan no permite activar Facebook Pages.';
    }

    const pageLimit = this.getFacebookPagesLimit();
    if (!canUseLimit(this.getCurrentFacebookPagesUsage(), pageLimit, 1)) {
      return 'Has alcanzado el límite de Pages activas. Actualiza tu plan.';
    }

    const integrationsLimit = this.getIntegrationLimit();
    if (!canUseLimit(this.getCurrentFacebookIntegrationUsage(), integrationsLimit, 1)) {
      return 'Has alcanzado el límite de integraciones activas. Actualiza tu plan.';
    }

    return null;
  }

  getGroupActivationGateReason(group: FacebookGroup): string | null {
    if (group.isActive) return null;
    if (!this.entitlements) return null;

    if (!isFeatureEnabled(this.entitlements.features, 'network.facebook.groups')) {
      return 'Tu plan no permite activar Facebook Groups.';
    }

    const groupLimit = this.getFacebookGroupsLimit();
    if (!canUseLimit(this.getCurrentFacebookGroupsUsage(), groupLimit, 1)) {
      return 'Has alcanzado el límite de Groups activas. Actualiza tu plan.';
    }

    const integrationsLimit = this.getIntegrationLimit();
    if (!canUseLimit(this.getCurrentFacebookIntegrationUsage(), integrationsLimit, 1)) {
      return 'Has alcanzado el límite de integraciones activas. Actualiza tu plan.';
    }

    return null;
  }

  private patchMetaActiveAccountsCount(delta: number, scope: 'facebook' | 'instagram'): void {
    if (delta === 0) return;

    if (scope === 'facebook' && this.facebookConnectionStatus) {
      this.facebookConnectionStatus = {
        ...this.facebookConnectionStatus,
        activeAccounts: Math.max(0, (this.facebookConnectionStatus.activeAccounts ?? 0) + delta)
      };
    }

    if (scope === 'instagram' && this.instagramConnectionStatus) {
      this.instagramConnectionStatus = {
        ...this.instagramConnectionStatus,
        activeAccounts: Math.max(0, (this.instagramConnectionStatus.activeAccounts ?? 0) + delta)
      };
    }

    if (this.metaGroupStatus) {
      this.metaGroupStatus = {
        ...this.metaGroupStatus,
        activeAccounts: Math.max(0, (this.metaGroupStatus.activeAccounts ?? 0) + delta)
      };
    }
  }

  loadConnectedPages(): void {
    this.loading = true;
    this.error = null;
    this.imageErrors.clear();

    this.social
      .getAccounts({
        providerGroup: 'meta',
        provider: 'facebook',
        accountType: 'page',
        status: 'connected',
        includeBindings: true
      })
      .subscribe({
      next: (accounts) => {
        this.facebookAccountByExternalId = new Map(
          accounts.map((a) => [a.externalAccountId, a])
        );
        this.pages = accounts.map((a) => this.social.accountToFacebookPage(a));
        this.loading = false;
      },
      error: (error) => {
        this.error = error.message || 'Error al cargar las páginas conectadas';
        this.loading = false;
        console.error('Error al cargar páginas:', error);
      }
    });
  }

  onConnectSuccess(connectionType: SocialConnectionType): void {
    this.confirmingConnection = connectionType;
    this.social.pollMetaIntegrationReady().subscribe({
      next: (snapshot) => {
        this.applyMetaIntegrationSnapshot(snapshot);
        this.confirmingConnection = null;
        this.refreshEntitlements();
      },
      error: () => {
        this.confirmingConnection = null;
        this.loadMetaStatus();
        this.loadConnectedPages();
        this.loadInstagramAccounts();
        this.refreshEntitlements();
      }
    });
  }

  private applyMetaIntegrationSnapshot(snapshot: MetaIntegrationSnapshot): void {
    this.metaGroupStatus = snapshot.group;
    this.facebookConnectionStatus = snapshot.facebookStatus;
    this.instagramConnectionStatus = snapshot.instagramStatus;
    this.facebookConnections = snapshot.facebookConnections ?? [];
    this.instagramConnections = snapshot.instagramConnections ?? [];
    this.metaStatusLoading = false;
    this.metaStatusError = null;

    this.facebookAccountByExternalId = new Map(
      snapshot.facebookPages.map((a) => [a.externalAccountId, a])
    );
    this.pages = snapshot.facebookPages.map((a) => this.social.accountToFacebookPage(a));
    this.loading = false;
    this.error = null;
    this.loadingFacebookConnections = false;
    this.loadingInstagramConnections = false;

    this.instagramAccounts = snapshot.instagramAccounts as MetaManagedAccount[];
    this.loadingInstagram = false;
    this.instagramError = null;
  }

  loadInstagramConnections(): void {
    this.loadingInstagramConnections = true;
    this.metaConnect.getInstagramConnections().subscribe({
      next: (connections) => {
        this.instagramConnections = connections;
        this.loadingInstagramConnections = false;
      },
      error: () => {
        this.instagramConnections = [];
        this.loadingInstagramConnections = false;
      }
    });
  }

  refreshInstagramIntegration(): void {
    this.social.refreshInstagramIntegrationBundle().subscribe({
      next: (bundle) => {
        this.instagramConnectionStatus = bundle.status;
        this.instagramConnections = bundle.connections;
        this.instagramAccounts = bundle.accounts as MetaManagedAccount[];
        this.loadingInstagram = false;
        this.instagramError = null;
        this.loadingInstagramConnections = false;
      },
      error: () => {
        this.loadMetaStatus();
        this.loadInstagramConnections();
        this.loadInstagramAccounts();
      }
    });
  }

  syncInstagramConnection(connection: SocialConnection): void {
    if (this.syncingConnectionIds.has(connection.id)) return;
    this.syncingConnectionIds.add(connection.id);
    this.metaConnect.syncInstagramConnection(connection.id).subscribe({
      next: () => {
        this.syncingConnectionIds.delete(connection.id);
        this.refreshInstagramIntegration();
        this.refreshEntitlementsSilently();
      },
      error: (err: unknown) => {
        this.syncingConnectionIds.delete(connection.id);
        alert(this.resolveInstagramConnectionError(err));
      }
    });
  }

  disconnectInstagramConnection(connection: SocialConnection): void {
    if (this.disconnectingConnectionIds.has(connection.id)) return;
    const label = this.formatConnectionLabel(connection);
    if (!confirm(`¿Desconectar el cliente Instagram ${label}?`)) {
      return;
    }
    this.disconnectingConnectionIds.add(connection.id);
    this.metaConnect.disconnectInstagramConnection(connection.id).subscribe({
      next: () => {
        this.disconnectingConnectionIds.delete(connection.id);
        this.refreshInstagramIntegration();
        this.refreshEntitlements();
      },
      error: (err: unknown) => {
        this.disconnectingConnectionIds.delete(connection.id);
        alert(this.resolveInstagramConnectionError(err));
      }
    });
  }

  reauthInstagramConnection(connection: SocialConnection): void {
    if (this.reauthingConnectionIds.has(connection.id)) return;
    this.reauthingConnectionIds.add(connection.id);
    this.metaConnect.reauthInstagramConnection(connection.id).subscribe({
      error: (err: unknown) => {
        this.reauthingConnectionIds.delete(connection.id);
        alert(this.resolveInstagramConnectionError(err));
      }
    });
  }

  loadFacebookConnections(): void {
    this.loadingFacebookConnections = true;
    this.metaConnect.getFacebookConnections().subscribe({
      next: (connections) => {
        this.facebookConnections = connections;
        this.loadingFacebookConnections = false;
      },
      error: () => {
        this.facebookConnections = [];
        this.loadingFacebookConnections = false;
      }
    });
  }

  refreshFacebookIntegration(): void {
    this.social.refreshFacebookIntegrationBundle().subscribe({
      next: (bundle) => {
        this.facebookConnectionStatus = bundle.status;
        this.facebookConnections = bundle.connections;
        this.facebookAccountByExternalId = new Map(
          bundle.pages.map((a) => [a.externalAccountId, a])
        );
        this.pages = bundle.pages.map((a) => this.social.accountToFacebookPage(a));
        this.loading = false;
        this.error = null;
        this.loadingFacebookConnections = false;
      },
      error: () => {
        this.loadMetaStatus();
        this.loadFacebookConnections();
        this.loadConnectedPages();
      }
    });
  }

  syncFacebookConnection(connection: SocialConnection): void {
    if (this.syncingConnectionIds.has(connection.id)) return;
    this.syncingConnectionIds.add(connection.id);
    this.metaConnect.syncFacebookConnection(connection.id).subscribe({
      next: (response) => {
        this.syncingConnectionIds.delete(connection.id);
        this.refreshFacebookIntegration();
        this.refreshEntitlementsSilently();
        const imported = response.accountsImported ?? 0;
        if (imported > 0) {
          this.router.navigate(['/dashboard/cuentas-conectadas/facebook/select'], {
            queryParams: {
              connectionId: connection.id,
              accountsImported: String(imported)
            }
          });
        }
      },
      error: (err: unknown) => {
        this.syncingConnectionIds.delete(connection.id);
        alert(this.resolveConnectionError(err));
      }
    });
  }

  disconnectFacebookConnection(connection: SocialConnection): void {
    if (this.disconnectingConnectionIds.has(connection.id)) return;
    const label = this.formatConnectionLabel(connection);
    if (
      !confirm(
        `¿Desconectar la cuenta Meta ${label}? Solo afecta las páginas vinculadas a esta cuenta.`
      )
    ) {
      return;
    }
    this.disconnectingConnectionIds.add(connection.id);
    this.metaConnect.disconnectFacebookConnection(connection.id).subscribe({
      next: () => {
        this.disconnectingConnectionIds.delete(connection.id);
        this.refreshFacebookIntegration();
        this.refreshEntitlements();
      },
      error: (err: unknown) => {
        this.disconnectingConnectionIds.delete(connection.id);
        alert(this.resolveConnectionError(err));
      }
    });
  }

  reauthFacebookConnection(connection: SocialConnection): void {
    if (this.reauthingConnectionIds.has(connection.id)) return;
    this.reauthingConnectionIds.add(connection.id);
    this.metaConnect.reauthFacebookConnection(connection.id).subscribe({
      error: (err: unknown) => {
        this.reauthingConnectionIds.delete(connection.id);
        alert(this.resolveConnectionError(err));
      }
    });
  }

  openFacebookPageSelector(connectionId: number): void {
    this.router.navigate(['/dashboard/cuentas-conectadas/facebook/select'], {
      queryParams: { connectionId }
    });
  }

  formatConnectionLabel(connection: SocialConnection): string {
    const label = connection.displayLabel?.trim();
    if (label) return label;
    return this.formatMetaUserId(connection.externalUserId);
  }

  private resolveSocialConnectionId(account: SocialAccount): number | undefined {
    if (account.socialConnectionId != null) {
      return account.socialConnectionId;
    }
    const binding = account.connectionBindings?.find((b) => b.isActive);
    return binding?.socialConnectionId;
  }

  private resolveAccountConnectError(err: unknown): string {
    if (isSocialApiError(err)) {
      if (err.code?.startsWith('SOCIAL_ACCOUNT_')) {
        return getSocialAccountConnectErrorMessage(err.code);
      }
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error al actualizar el estado de la página.';
  }

  private resolveInstagramConnectionError(err: unknown): string {
    if (isSocialApiError(err)) {
      return getSocialInstagramConnectionErrorMessage(
        err.code,
        this.instagramConnectionStatus ?? undefined
      );
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error en la operación de conexión Instagram.';
  }

  private resolveConnectionError(err: unknown): string {
    if (isSocialApiError(err)) {
      if (err.code?.startsWith('SOCIAL_CONNECTION_')) {
        return getSocialConnectionErrorMessage(err.code, this.getMaxFacebookConnections());
      }
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error en la operación.';
  }

  loadMetaStatus(): void {
    this.metaStatusLoading = true;
    this.metaStatusError = null;
    this.social.getProviderGroupStatus('meta').subscribe({
      next: (group) => {
        this.metaGroupStatus = group;
        this.metaStatusLoading = false;
      },
      error: (err: Error) => {
        this.metaStatusError = err.message;
        this.metaStatusLoading = false;
      }
    });
    this.social.getConnectionTypeStatus('meta', 'facebook_login').subscribe({
      next: (s) => {
        this.facebookConnectionStatus = s;
        this.loadFacebookConnections();
      },
      error: () => (this.facebookConnectionStatus = null)
    });
    this.social.getConnectionTypeStatus('meta', 'instagram_login').subscribe({
      next: (s) => {
        this.instagramConnectionStatus = s;
        this.loadInstagramConnections();
      },
      error: () => (this.instagramConnectionStatus = null)
    });
  }

  loadInstagramAccounts(): void {
    this.loadingInstagram = true;
    this.instagramError = null;
    this.metaConnect.getAccounts({ provider: 'instagram' }).subscribe({
      next: (accounts) => {
        this.instagramAccounts = accounts;
        this.loadingInstagram = false;
      },
      error: (err: Error) => {
        this.instagramError = err.message;
        this.loadingInstagram = false;
      }
    });
  }

  isInstagramFeatureEnabled(): boolean {
    if (!this.entitlements) return true;
    return isFeatureEnabled(this.entitlements.features, 'network.instagram');
  }

  get instagramActiveAccounts(): MetaManagedAccount[] {
    return this.instagramAccounts.filter((a) => a.isActive);
  }

  get instagramInactiveAccounts(): MetaManagedAccount[] {
    return this.instagramAccounts.filter((a) => !a.isActive);
  }

  isReconnectingAccount(accountId: number): boolean {
    return this.reconnectingAccountIds.has(accountId);
  }

  isHidingAccount(accountId: number): boolean {
    return this.hidingAccountIds.has(accountId);
  }

  isDeletingAccount(accountId: number): boolean {
    return this.deletingAccountIds.has(accountId);
  }

  isAccountActionInProgress(accountId: number): boolean {
    return (
      this.isReconnectingAccount(accountId) ||
      this.isHidingAccount(accountId) ||
      this.isDeletingAccount(accountId)
    );
  }

  /** Solo cuentas revocadas e inactivas (regla backend DELETE). */
  canDeleteAccount(account: SocialAccount): boolean {
    return this.isAccountDisconnectedRevoked(account);
  }

  hideAccountFromList(account: SocialAccount): void {
    if (this.isAccountActionInProgress(account.id)) return;

    const label = account.displayName || 'esta cuenta';
    if (!confirm(`¿Ocultar «${label}» de la lista? No cambia tokens ni estado activo. Puedes volver a verla al reconectar.`)) {
      return;
    }

    this.hidingAccountIds.add(account.id);
    this.social.setAccountVisibility(account.id, true).subscribe({
      next: () => {
        this.hidingAccountIds.delete(account.id);
        this.removeAccountFromLocalState(account);
        this.refreshMetaAfterAccountListChange();
      },
      error: (err: unknown) => {
        this.hidingAccountIds.delete(account.id);
        alert(isSocialApiError(err) ? err.message : 'Error al ocultar la cuenta.');
      }
    });
  }

  deleteAccountHistory(account: SocialAccount): void {
    if (!this.canDeleteAccount(account)) {
      alert('Solo puedes eliminar cuentas inactivas con token revocado.');
      return;
    }
    if (this.isAccountActionInProgress(account.id)) return;

    const label = account.displayName || 'esta cuenta';
    if (!confirm(`¿Eliminar el historial de «${label}»? Se quitará de colecciones y no podrás deshacerlo.`)) {
      return;
    }

    this.deletingAccountIds.add(account.id);
    this.social.deleteAccount(account.id).subscribe({
      next: () => {
        this.deletingAccountIds.delete(account.id);
        this.removeAccountFromLocalState(account);
        this.refreshMetaAfterAccountListChange();
      },
      error: (err: unknown) => {
        this.deletingAccountIds.delete(account.id);
        if (isSocialApiError(err)) {
          alert(getSocialDeleteErrorMessage(err.code) || err.message);
        } else {
          alert('Error al eliminar la cuenta.');
        }
      }
    });
  }

  private removeAccountFromLocalState(account: SocialAccount): void {
    if (account.provider === 'facebook') {
      this.pages = this.pages.filter((p) => p.facebookPageId !== account.externalAccountId);
      this.facebookAccountByExternalId.delete(account.externalAccountId);
    } else if (account.provider === 'instagram') {
      this.instagramAccounts = this.instagramAccounts.filter((a) => a.id !== account.id);
    }
  }

  private refreshMetaAfterAccountListChange(): void {
    this.social.pollMetaIntegrationReady().subscribe({
      next: (snapshot) => this.applyMetaIntegrationSnapshot(snapshot),
      error: () => this.loadMetaStatus()
    });
  }

  getAccountStatusLabel(account: SocialAccount): string {
    const token = (account.tokenStatus ?? '').toLowerCase();
    if (token === 'revoked' || account.requiresReconnect) return 'Token revocado';
    if (token === 'valid') return 'Conectada';
    return account.tokenStatus || 'Desconocida';
  }

  isAccountDisconnectedRevoked(account: SocialAccount): boolean {
    return !account.isActive && this.isAccountTokenRevoked(account);
  }

  isPageDisconnectedRevoked(page: FacebookPage): boolean {
    const account = this.getFacebookAccount(page);
    return account ? this.isAccountDisconnectedRevoked(account) : !page.isActive;
  }

  isPageTokenRevoked(page: FacebookPage): boolean {
    const account = this.getFacebookAccount(page);
    return account ? this.isAccountTokenRevoked(account) : false;
  }

  reconnectSocialAccount(account: SocialAccount): void {
    if (this.reconnectingAccountIds.has(account.id)) {
      return;
    }
    this.reconnectingAccountIds.add(account.id);

    this.social.reconnectAccount(account.id).subscribe({
      next: (response) => {
        this.reconnectingAccountIds.delete(account.id);
        this.handleReconnectResponse(response);
      },
      error: (err: unknown) => {
        this.reconnectingAccountIds.delete(account.id);
        if (isSocialApiError(err)) {
          alert(err.message || 'Error al reconectar la cuenta.');
        } else {
          alert(err instanceof Error ? err.message : 'Error al reconectar la cuenta.');
        }
      }
    });
  }

  private handleReconnectResponse(response: SocialReconnectAccountResponse): void {
    if (response.outcome === 'success') {
      if (response.account) {
        this.applyReconnectedAccount(response.account);
      } else {
        this.refreshMetaAfterAccountListChange();
      }
      return;
    }

    if (response.outcome === 'oauth_required') {
      if (response.message) {
        alert(response.message);
      }
      if (response.authorizationUrl) {
        window.location.href = response.authorizationUrl;
        return;
      }
      alert('Se requiere autorizar la cuenta en Facebook. Intenta de nuevo.');
      return;
    }

    alert(response.message || 'No se pudo reconectar la cuenta.');
  }

  reconnectFacebookPage(page: FacebookPage): void {
    const account = this.getFacebookAccount(page);
    if (!account) {
      alert('No se encontró la cuenta gestionada para esta página.');
      return;
    }
    this.reconnectSocialAccount(account);
  }

  reconnectInstagramAccount(account: MetaManagedAccount): void {
    this.reconnectSocialAccount(account);
  }

  private applyReconnectedAccount(updated: SocialAccount): void {
    if (updated.provider === 'facebook') {
      this.facebookAccountByExternalId.set(updated.externalAccountId, updated);
      const mapped = this.social.accountToFacebookPage(updated);
      const index = this.pages.findIndex((p) => p.facebookPageId === updated.externalAccountId);
      if (index !== -1) {
        this.pages[index] = mapped;
      } else {
        this.pages = [...this.pages, mapped];
      }
    } else if (updated.provider === 'instagram') {
      const index = this.instagramAccounts.findIndex((a) => a.id === updated.id);
      if (index !== -1) {
        this.instagramAccounts[index] = updated as MetaManagedAccount;
      }
    }

    this.social.pollMetaIntegrationReady().subscribe({
      next: (snapshot) => this.applyMetaIntegrationSnapshot(snapshot),
      error: () => {
        this.loadMetaStatus();
        this.loadConnectedPages();
        this.loadInstagramAccounts();
      }
    });
  }

  getPagePublishHint(page: FacebookPage): string | null {
    const account = this.getFacebookAccount(page);
    if (!account) return null;
    if (page.isActive && !page.canPublish) {
      if (this.isAccountTokenRevoked(account)) {
        return 'Activa en tenant pero token revocado: no publicará hasta sincronizar o reconectar OAuth.';
      }
      return 'Activa pero sin token válido para publicar.';
    }
    if (!page.isActive && this.isAccountTokenRevoked(account)) {
      return 'Esta página no puede publicar ni sincronizar datos.';
    }
    if (!page.canPublish) {
      return 'Sin token válido para publicar.';
    }
    return null;
  }

  isInstagramActivationAllowed(account: MetaManagedAccount): boolean {
    if (account.isActive) return true;
    if (!this.isInstagramFeatureEnabled()) return false;
    if (this.isAccountTokenRevoked(account)) return false;
    return account.canPublish && !account.requiresReconnect;
  }

  getInstagramActivationGateReason(account: MetaManagedAccount): string | null {
    if (account.isActive) return null;
    if (!this.isInstagramFeatureEnabled()) {
      return 'Tu plan no permite Instagram.';
    }
    if (this.isAccountTokenRevoked(account)) {
      return 'Token revocado. Sincroniza Meta o reconecta Instagram; PATCH isActive no restaura el token.';
    }
    if (account.requiresReconnect) {
      return 'Reconecta la cuenta de Instagram.';
    }
    if (!account.canPublish) {
      return 'Esta cuenta no puede publicar hasta sincronizar o reconectar OAuth.';
    }
    return null;
  }

  getInstagramPublishHint(account: MetaManagedAccount): string | null {
    if (account.isActive && !account.canPublish) {
      if (this.isAccountTokenRevoked(account)) {
        return 'Activa en tenant pero token revocado: no publicará hasta sincronizar o reconectar.';
      }
      return 'Activa pero sin token válido para publicar.';
    }
    if (!account.isActive && this.isAccountTokenRevoked(account)) {
      return 'Esta cuenta no puede publicar ni sincronizar datos.';
    }
    return null;
  }

  updateInstagramAccountStatus(account: MetaManagedAccount, isActive: boolean): void {
    if (this.updatingInstagramStatus.has(account.id) || account.isActive === isActive) {
      return;
    }
    if (isActive && !this.isInstagramActivationAllowed(account)) {
      alert(this.getInstagramActivationGateReason(account) || 'No puedes activar esta cuenta.');
      return;
    }
    this.updatingInstagramStatus.add(account.id);
    this.metaConnect.updateAccountStatus(account.id, isActive).subscribe({
      next: (updated) => {
        const wasActive = account.isActive;
        const idx = this.instagramAccounts.findIndex((a) => a.id === account.id);
        if (idx !== -1) {
          this.instagramAccounts[idx] = updated;
        }
        this.updatingInstagramStatus.delete(account.id);
        if (updated.isActive !== wasActive) {
          this.patchMetaActiveAccountsCount(updated.isActive ? 1 : -1, 'instagram');
        }
        this.refreshEntitlementsSilently();
      },
      error: (err: Error) => {
        this.updatingInstagramStatus.delete(account.id);
        alert(err.message || 'Error al actualizar la cuenta de Instagram.');
      }
    });
  }

  isUpdatingInstagramStatus(accountId: number): boolean {
    return this.updatingInstagramStatus.has(accountId);
  }

  syncMetaAccounts(): void {
    if (this.syncingMeta) return;
    this.syncingMeta = true;
    this.metaConnect.syncAccounts().subscribe({
      next: () => {
        this.social.pollMetaIntegrationReady().subscribe({
          next: (snapshot) => {
            this.applyMetaIntegrationSnapshot(snapshot);
            this.syncingMeta = false;
            this.refreshEntitlements();
          },
          error: () => {
            this.syncingMeta = false;
            this.loadMetaStatus();
            this.loadConnectedPages();
            this.loadInstagramAccounts();
          }
        });
      },
      error: (err: Error) => {
        this.syncingMeta = false;
        alert(err.message || 'Error al sincronizar cuentas Meta.');
      }
    });
  }

  disconnectMeta(connectionType: 'facebook_login' | 'instagram_login'): void {
    if (this.disconnectingMeta) return;
    const isFacebook = connectionType === 'facebook_login';
    const label = isFacebook ? 'Facebook' : 'Instagram';
    const confirmMsg = isFacebook
      ? `¿Desconectar TODAS las cuentas Meta (${this.getFacebookConnectionCount()})? Se revocarán todas las conexiones OAuth de Facebook en este espacio.`
      : `¿Desconectar TODAS las cuentas Instagram (${this.getInstagramConnectionCount()})? Se revocarán todas las conexiones OAuth de Instagram en este espacio.`;
    if (!confirm(confirmMsg)) {
      return;
    }
    this.disconnectingMeta = connectionType;
    this.metaConnect.disconnect(connectionType).subscribe({
      next: () => {
        this.disconnectingMeta = null;
        if (isFacebook) {
          this.refreshFacebookIntegration();
        } else {
          this.refreshInstagramIntegration();
        }
        this.refreshEntitlements();
      },
      error: (err: Error) => {
        this.disconnectingMeta = null;
        alert(err.message || `Error al desconectar ${label}.`);
      }
    });
  }

  getAccountInitial(name?: string): string {
    const trimmed = name?.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  get activeFacebookPagesCount(): number {
    return this.pages.filter((p) => p.isActive).length;
  }

  get activeInstagramAccountsCount(): number {
    return this.instagramAccounts.filter((a) => a.isActive).length;
  }

  /** Sync terminó con upserts pero activeAccounts aún en 0 (backend procesando). */
  get hasMetaAccountsSyncPending(): boolean {
    if (this.confirmingConnection) return true;

    for (const status of [this.facebookConnectionStatus, this.instagramConnectionStatus]) {
      if (!status?.connected) continue;
      if ((status.activeAccounts ?? 0) > 0) continue;

      const sync = status.lastSyncStatus ?? '';
      const upserted = status.lastSyncAccountsUpserted ?? 0;
      if ((sync === 'success' || sync === 'partial') && upserted > 0) {
        return true;
      }
    }

    return false;
  }

  /** Cuentas con token válido que el usuario puede activar con el toggle. */
  get hasActivatableMetaAccounts(): boolean {
    const activatablePage = this.pages.some((page) => {
      const account = this.getFacebookAccount(page);
      return account && !account.isActive && !this.isAccountTokenRevoked(account);
    });
    const activatableIg = this.instagramAccounts.some(
      (account) => !account.isActive && !this.isAccountTokenRevoked(account)
    );
    return activatablePage || activatableIg;
  }

  get hasMetaAccountsAllRevoked(): boolean {
    if (this.pages.length === 0) return false;
    return this.pages.every((page) => {
      const account = this.getFacebookAccount(page);
      return account ? this.isAccountTokenRevoked(account) : true;
    });
  }

  /** OAuth conectado pero cuentas Instagram inactivas con token usable. */
  get hasMetaAccountsPendingActivation(): boolean {
    if (!this.metaGroupStatus?.connected) return false;
    if (this.hasMetaAccountsSyncPending) return false;
    if (this.hasMetaAccountsNeedingTokenRefresh) return false;
    if ((this.metaGroupStatus.activeAccounts ?? 0) > 0) return false;
    return this.instagramAccounts.some(
      (account) => !account.isActive && !this.isAccountTokenRevoked(account)
    );
  }

  /** Tokens revocados o sync sin dejar cuentas activas. */
  get hasMetaAccountsNeedingTokenRefresh(): boolean {
    if (!this.metaGroupStatus?.connected) return false;
    if ((this.metaGroupStatus.canPublishAccounts ?? 0) > 0) return false;

    if (this.facebookConnectionStatus?.requiresReconnect) return true;
    if (this.instagramConnectionStatus?.requiresReconnect) return true;

    if (
      (this.metaGroupStatus.activeAccounts ?? 0) === 0 &&
      this.pages.length > 0 &&
      this.hasMetaAccountsAllRevoked
    ) {
      return true;
    }

    const revokedActivePage = this.pages.some((page) => {
      if (!page.isActive) return false;
      const account = this.getFacebookAccount(page);
      return account ? this.isAccountTokenRevoked(account) : false;
    });
    if (revokedActivePage) return true;

    return this.instagramAccounts.some(
      (account) => account.isActive && this.isAccountTokenRevoked(account)
    );
  }

  get hasMetaAccountsNotPublishable(): boolean {
    if (!this.metaGroupStatus?.connected) return false;
    return this.metaGroupStatus.totalAccounts > 0 && this.metaGroupStatus.canPublishAccounts === 0;
  }

  getFacebookConnectionLabel(): string {
    const status = this.facebookConnectionStatus;
    const count = this.getFacebookConnectionCount();
    if (count === 0) return 'No conectado';
    if (status?.requiresReconnect) return `${count} cuenta(s) Meta · Reconectar`;
    return count === 1 ? '1 cuenta Meta' : `${count} cuentas Meta`;
  }

  getFacebookConnectionsBadgeLabel(): string {
    const count = this.getFacebookConnectionCount();
    const max = this.getMaxFacebookConnections();
    if (max != null) {
      return `${count} / ${max} cuentas Meta conectadas`;
    }
    return count === 1 ? '1 cuenta Meta conectada' : `${count} cuentas Meta conectadas`;
  }

  getFacebookConnectionCount(): number {
    if (!this.facebookConnectionStatus) return 0;
    return this.social.getConnectionCount(this.facebookConnectionStatus);
  }

  getMaxFacebookConnections(): number | undefined {
    return this.facebookConnectionStatus?.maxConnectionsPerTenant;
  }

  hasFacebookOAuthConnections(): boolean {
    if (!this.facebookConnectionStatus) return false;
    return this.social.hasActiveConnections(this.facebookConnectionStatus);
  }

  canAddFacebookConnection(): boolean {
    const status = this.facebookConnectionStatus;
    if (!status?.allowMultipleConnectionsPerTenant) {
      return !this.hasFacebookOAuthConnections();
    }
    const max = status.maxConnectionsPerTenant;
    const count = this.getFacebookConnectionCount();
    if (max == null) return true;
    return count < max;
  }

  getInstagramConnectionCount(): number {
    if (!this.instagramConnectionStatus) return 0;
    return this.social.getConnectionCount(this.instagramConnectionStatus);
  }

  getMaxInstagramConnections(): number | undefined {
    return this.instagramConnectionStatus?.maxConnectionsPerTenant;
  }

  getMaxInstagramAccounts(): number | undefined {
    return this.instagramConnectionStatus?.maxInstagramAccounts;
  }

  hasInstagramOAuthConnections(): boolean {
    if (!this.instagramConnectionStatus) return false;
    return this.social.hasActiveConnections(this.instagramConnectionStatus);
  }

  getInstagramConnectionsBadgeLabel(): string {
    const count = this.getInstagramConnectionCount();
    const max = this.getMaxInstagramConnections();
    if (max != null) {
      return `${count} / ${max} conexiones OAuth`;
    }
    return count === 1 ? '1 conexión OAuth' : `${count} conexiones OAuth`;
  }

  getInstagramAccountsBadgeLabel(): string {
    const status = this.instagramConnectionStatus;
    const active = status?.activeInstagramAccounts ?? status?.activeAccounts ?? 0;
    const max = this.getMaxInstagramAccounts();
    if (max != null) {
      return `${active} / ${max} cuentas activas`;
    }
    return active === 1 ? '1 cuenta activa' : `${active} cuentas activas`;
  }

  canAddInstagramConnection(): boolean {
    const status = this.instagramConnectionStatus;
    if (!status?.allowMultipleConnectionsPerTenant) {
      return !this.hasInstagramOAuthConnections();
    }
    const remainingConn = status.remainingConnections;
    const remainingAccounts = status.remainingInstagramAccounts;
    if (remainingConn != null && remainingConn <= 0) return false;
    if (remainingAccounts != null && remainingAccounts <= 0) return false;
    const max = status.maxConnectionsPerTenant;
    const count = this.getInstagramConnectionCount();
    if (max == null) return true;
    return count < max;
  }

  formatMetaUserId(externalUserId: string): string {
    const id = (externalUserId ?? '').trim();
    if (id.length <= 6) return id || 'Meta';
    return `…${id.slice(-6)}`;
  }

  getConnectionTokenLabel(connection: SocialConnection): string {
    const token = (connection.tokenStatus ?? '').toLowerCase();
    if (connection.requiresReconnect || token === 'revoked') return 'Token revocado';
    if (token === 'valid') return 'Válido';
    return connection.tokenStatus || 'Desconocido';
  }

  isSyncingConnection(connectionId: number): boolean {
    return this.syncingConnectionIds.has(connectionId);
  }

  isDisconnectingConnection(connectionId: number): boolean {
    return this.disconnectingConnectionIds.has(connectionId);
  }

  isReauthingConnection(connectionId: number): boolean {
    return this.reauthingConnectionIds.has(connectionId);
  }

  isConnectionRowBusy(connectionId: number): boolean {
    return (
      this.isSyncingConnection(connectionId) ||
      this.isDisconnectingConnection(connectionId) ||
      this.isReauthingConnection(connectionId)
    );
  }

  getSharedBindingsCount(page: FacebookPage): number {
    const account = this.getFacebookAccount(page);
    return account?.connectionBindings?.filter((b) => b.isActive).length ?? 0;
  }

  hasSharedPageBindings(page: FacebookPage): boolean {
    return this.getSharedBindingsCount(page) > 1;
  }

  getInstagramConnectionLabel(): string {
    const status = this.instagramConnectionStatus;
    const count = this.getInstagramConnectionCount();
    if (count === 0) return 'No conectado';
    if (status?.requiresReconnect) return `${count} cliente(s) IG · Reconectar`;
    return count === 1 ? '1 cliente IG' : `${count} clientes IG`;
  }

  /** Texto principal para el usuario: «2 páginas conectadas». */
  getConnectionActiveLabel(
    status: SocialConnectionTypeStatus | null,
    kind: 'page' | 'account'
  ): string {
    if (!status || !this.social.hasActiveConnections(status)) return '';
    const active = status.activeAccounts ?? 0;
    if (kind === 'page') {
      return active === 1 ? '1 página conectada' : `${active} páginas conectadas`;
    }
    return active === 1 ? '1 cuenta conectada' : `${active} cuentas conectadas`;
  }

  /** Texto opcional: «11 desvinculadas» si hasInactiveAccounts. */
  getConnectionInactiveLabel(status: SocialConnectionTypeStatus | null): string | null {
    if (!status || !this.social.hasActiveConnections(status) || !status.hasInactiveAccounts) return null;
    const inactive = status.inactiveAccounts ?? 0;
    if (inactive <= 0) return null;
    return inactive === 1 ? '1 desvinculada' : `${inactive} desvinculadas`;
  }

  getConnectionAccountsSummary(
    status: SocialConnectionTypeStatus | null,
    kind: 'page' | 'account'
  ): string {
    const active = this.getConnectionActiveLabel(status, kind);
    const inactive = this.getConnectionInactiveLabel(status);
    return inactive ? `${active} · ${inactive}` : active;
  }

  /** Páginas con permisos vigentes (activas o desconectadas por el usuario). */
  get facebookConnectedPages(): FacebookPage[] {
    return this.pages.filter((p) => !this.isPageTokenRevoked(p));
  }

  /** Páginas sin permisos en Meta (token revocado). */
  get facebookUnlinkedPages(): FacebookPage[] {
    return this.pages.filter((p) => this.isPageTokenRevoked(p));
  }

  isFacebookConnectionWarning(): boolean {
    const status = this.facebookConnectionStatus;
    if (!status || !this.social.hasActiveConnections(status)) return false;
    if (status.requiresReconnect) return true;
    return (status.activeAccounts ?? 0) === 0;
  }

  isInstagramConnectionWarning(): boolean {
    const status = this.instagramConnectionStatus;
    if (!status?.connected) return false;
    if (status.requiresReconnect) return true;
    return (status.activeAccounts ?? 0) === 0;
  }

  formatSyncStatus(status?: string | null): string {
    const map: Record<string, string> = {
      success: 'Éxito',
      failed: 'Fallida',
      partial: 'Parcial'
    };
    return status ? map[status] ?? status : '—';
  }

  formatSyncDate(dateString?: string | null): string {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getConnectionSyncSummary(status: SocialConnectionTypeStatus | null): string {
    if (!status?.connected) return '';
    const parts = [
      `Sync: ${this.formatSyncStatus(status.lastSyncStatus)}`,
      `Última: ${this.formatSyncDate(status.lastSyncAt)}`,
      `Token OAuth: ${status.tokenStatus ?? '—'}`
    ];
    if (typeof status.lastSyncAccountsUpserted === 'number') {
      parts.push(`Último sync: ${status.lastSyncAccountsUpserted} upsertada${status.lastSyncAccountsUpserted === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
  }

  onImageError(pageId: string): void {
    this.imageErrors.add(pageId);
  }

  hasImageError(pageId: string): boolean {
    return this.imageErrors.has(pageId);
  }

  updatePageStatus(page: FacebookPage, newStatus: boolean): void {
    if (this.updatingStatus.has(page.facebookPageId) || page.isActive === newStatus) {
      return;
    }

    if (newStatus && !this.isPageActivationAllowed(page)) {
      const reason = this.getPageActivationGateReason(page);
      alert(reason || 'No puedes conectar esta página con tu plan actual.');
      return;
    }

    this.updatingStatus.add(page.facebookPageId);

    const account = this.facebookAccountByExternalId.get(page.facebookPageId);
    if (!account) {
      this.updatingStatus.delete(page.facebookPageId);
      alert('No se encontró la cuenta gestionada para esta página.');
      return;
    }

    const socialConnectionId = this.resolveSocialConnectionId(account);
    if (socialConnectionId == null) {
      this.updatingStatus.delete(page.facebookPageId);
      alert('No se pudo determinar la conexión Meta de esta página.');
      return;
    }

    if (newStatus) {
      this.social.connectAccount(account.id, socialConnectionId).subscribe({
        next: () => {
          this.updatingStatus.delete(page.facebookPageId);
          this.patchMetaActiveAccountsCount(1, 'facebook');
          this.loadConnectedPages();
          this.refreshEntitlementsSilently();
        },
        error: (error: unknown) => {
          this.updatingStatus.delete(page.facebookPageId);
          console.error('Error al conectar la página:', error);
          alert(this.resolveAccountConnectError(error));
        }
      });
      return;
    }

    this.social.disconnectAccountFromWorkspace(account.id, socialConnectionId).subscribe({
      next: () => {
        this.updatingStatus.delete(page.facebookPageId);
        this.patchMetaActiveAccountsCount(-1, 'facebook');
        this.loadConnectedPages();
        this.refreshEntitlementsSilently();
      },
      error: (error: unknown) => {
        this.updatingStatus.delete(page.facebookPageId);
        console.error('Error al desconectar la página:', error);
        alert(this.resolveAccountConnectError(error));
      }
    });
  }

  /**
   * Verifica si una página está siendo actualizada.
   * @param pageId ID de la página
   */
  isUpdatingStatus(pageId: string): boolean {
    return this.updatingStatus.has(pageId);
  }

  // ============================================
  // Métodos para Grupos de Facebook
  // ============================================

  /**
   * Carga todos los grupos de Facebook del usuario.
   */
  loadGroups(): void {
    this.loadingGroups = true;
    this.groupsError = null;
    this.groupImageErrors.clear();

    this.groupsService.getGroups().subscribe({
      next: (response) => {
        this.groups = response.data;
        this.loadingGroups = false;
      },
      error: (error) => {
        this.groupsError = error.message || 'Error al cargar los grupos conectados';
        this.loadingGroups = false;
        console.error('Error al cargar grupos:', error);
      }
    });
  }

  /**
   * Muestra/oculta el formulario para agregar un grupo.
   */
  toggleAddGroupForm(): void {
    this.showAddGroupForm = !this.showAddGroupForm;
    if (!this.showAddGroupForm) {
      this.groupUrl = '';
    }
  }

  /**
   * Agrega un nuevo grupo de Facebook desde una URL.
   */
  addGroup(): void {
    if (!this.groupUrl || this.groupUrl.trim() === '') {
      alert('Por favor, ingresa la URL del grupo de Facebook');
      return;
    }

    if (this.addingGroup) {
      return;
    }

    this.addingGroup = true;
    const urlToAdd = this.groupUrl.trim();

    this.groupsService.addGroup(urlToAdd).subscribe({
      next: (response) => {
        // Agregar el nuevo grupo a la lista
        this.groups.unshift(response.data);
        // Limpiar el formulario
        this.groupUrl = '';
        this.showAddGroupForm = false;
        this.addingGroup = false;

        // Backend puede desactivar recursos adicionales globalmente; refrescar UI.
        this.refreshEntitlementsAndReloadLists();
      },
      error: (error) => {
        this.addingGroup = false;
        console.error('Error al agregar grupo:', error);
        alert(error.message || 'Error al agregar el grupo. Por favor, verifica que la URL sea correcta y que tengas permisos para acceder al grupo.');
      }
    });
  }

  /**
   * Maneja errores de carga de imágenes de grupos.
   */
  onGroupImageError(groupId: number): void {
    this.groupImageErrors.add(groupId);
  }

  /**
   * Verifica si una imagen de grupo tiene error.
   */
  hasGroupImageError(groupId: number): boolean {
    return this.groupImageErrors.has(groupId);
  }

  /**
   * Actualiza el estado (isActive) de un grupo de Facebook.
   * @param group Grupo de Facebook a actualizar
   * @param newStatus Nuevo estado (true = activo, false = inactivo)
   */
  updateGroupStatus(group: FacebookGroup, newStatus: boolean): void {
    // Si ya está actualizando o el estado es el mismo, no hacer nada
    if (this.updatingGroupStatus.has(group.facebookGroupId) || group.isActive === newStatus) {
      return;
    }

    if (newStatus && !this.isGroupActivationAllowed(group)) {
      const reason = this.getGroupActivationGateReason(group);
      alert(reason || 'No puedes activar este grupo con tu plan actual.');
      return;
    }

    this.updatingGroupStatus.add(group.facebookGroupId);

    this.groupsService.updateGroupStatus(group.facebookGroupId, newStatus).subscribe({
      next: (response) => {
        // Actualizar el grupo en el array local con los datos actualizados del servidor
        const index = this.groups.findIndex(g => g.facebookGroupId === group.facebookGroupId);
        if (index !== -1) {
          this.groups[index] = response.data;
        }
        this.updatingGroupStatus.delete(group.facebookGroupId);

        // Backend puede desactivar recursos adicionales globalmente; refrescar UI.
        this.refreshEntitlementsAndReloadLists();
      },
      error: (error) => {
        this.updatingGroupStatus.delete(group.facebookGroupId);
        console.error('Error al actualizar el estado del grupo:', error);
        // Mostrar mensaje de error al usuario
        alert(error.message || 'Error al actualizar el estado del grupo. Por favor, intenta nuevamente.');
      }
    });
  }

  /**
   * Verifica si un grupo está siendo actualizado.
   * @param groupId ID del grupo
   */
  isUpdatingGroupStatus(groupId: string): boolean {
    return this.updatingGroupStatus.has(groupId);
  }

  /**
   * Calcula el tiempo transcurrido desde una fecha.
   */
  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return 'hace unos segundos';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    } else if (diffInSeconds < 2592000) {
      const days = Math.floor(diffInSeconds / 86400);
      return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
    } else {
      const months = Math.floor(diffInSeconds / 2592000);
      return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
    }
  }
}
