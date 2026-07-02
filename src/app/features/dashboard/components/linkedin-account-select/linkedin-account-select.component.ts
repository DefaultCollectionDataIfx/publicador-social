import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { SocialService } from '../../../../core/services/social.service';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import {
  getSocialAccountConnectErrorMessage,
  getSocialLinkedInConnectionErrorMessage,
  isSocialApiError
} from '../../../../shared/utils/social-api.error';
import {
  SocialConnection,
  SocialConnectAccountResponse,
  SocialSelectorAccount
} from '../../../social/models/social.model';

@Component({
  selector: 'app-linkedin-account-select',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './linkedin-account-select.component.html',
  styleUrl: './linkedin-account-select.component.scss'
})
export class LinkedInAccountSelectComponent implements OnInit {
  private static readonly LIST_ROUTE = '/dashboard/cuentas-conectadas';

  connectionId: number | null = null;
  connection: SocialConnection | null = null;
  accounts: SocialSelectorAccount[] = [];
  selectedIds = new Set<number>();
  remainingOrgSlots: number | null = null;
  maxOrgSlots = 0;
  activeOrgSlotsUsed = 0;
  connectedThisSession = 0;

  loading = true;
  connecting = false;
  error: string | null = null;
  successMessage: string | null = null;
  postOAuthMessage: string | null = null;
  postOAuthWarning: string | null = null;
  postOAuthError: string | null = null;
  imageErrors = new Set<number>();
  connectingAccountIds = new Set<number>();
  rowSuccessMessages = new Map<number, string>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private social: SocialService,
    private tenantEntitlements: TenantEntitlementsService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const rawId = params.get('connectionId');
      const parsed = rawId != null ? Number(rawId) : NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) {
        this.router.navigate([LinkedInAccountSelectComponent.LIST_ROUTE], {
          queryParams: { liError: 'missing_connection' }
        });
        return;
      }

      this.connectionId = parsed;
      this.readPostOAuthParams(params);
      this.loadSelector();
    });
  }

  private readPostOAuthParams(params: import('@angular/router').ParamMap): void {
    this.postOAuthMessage = null;
    this.postOAuthWarning = null;
    this.postOAuthError = null;

    const imported = params.get('accountsImported');
    if (imported != null && imported !== '') {
      const count = Number(imported);
      if (Number.isFinite(count) && count > 0) {
        this.postOAuthMessage = `${count} cuenta${count === 1 ? '' : 's'} disponible${count === 1 ? '' : 's'} para conectar.`;
      }
    }

    const warning = params.get('warning');
    if (warning === 'LINKEDIN_NO_ADMIN_ORGANIZATIONS') {
      this.postOAuthWarning =
        'LinkedIn conectado. Selecciona el perfil para publicar. Las páginas de empresa aparecerán cuando LinkedIn apruebe la app.';
    }

    const liError = params.get('liError');
    if (liError) {
      this.postOAuthError = liError.startsWith('SOCIAL_') || liError.startsWith('LINKEDIN_')
        ? getSocialLinkedInConnectionErrorMessage(liError)
        : 'No se pudo completar la conexión con LinkedIn.';
    }
  }

  reloadSelector(): void {
    this.loadSelector();
  }

  private loadSelector(): void {
    if (this.connectionId == null) return;

    this.loading = true;
    this.error = null;
    this.successMessage = null;
    this.selectedIds.clear();
    this.rowSuccessMessages.clear();

    this.social.getConnectionAccounts(this.connectionId, 'available').subscribe({
      next: (data) => {
        this.connection = data.connection;
        this.accounts = data.accounts ?? [];
        this.applyOrgSlots(data.remainingSlots, data.maxSlots ?? 0, data.activeSlotsUsed ?? 0);
        this.loading = false;
      },
      error: (err: unknown) => {
        this.loading = false;
        this.error = this.resolveError(err);
      }
    });
  }

  private applyOrgSlots(
    remainingSlots: number | null | undefined,
    maxSlots: number,
    activeSlotsUsed: number
  ): void {
    this.remainingOrgSlots = remainingSlots ?? null;
    this.maxOrgSlots = maxSlots;
    this.activeOrgSlotsUsed = activeSlotsUsed;
    if (maxSlots > 0 && activeSlotsUsed === 0 && remainingSlots != null && remainingSlots <= maxSlots) {
      this.activeOrgSlotsUsed = maxSlots - remainingSlots;
    }
  }

  get connectionLabel(): string {
    if (!this.connection) return 'Miembro LinkedIn';
    return this.connection.displayLabel?.trim() || this.formatUserId(this.connection.externalUserId);
  }

  get selectableAccounts(): SocialSelectorAccount[] {
    return this.accounts.filter((a) => this.canConnectOne(a));
  }

  get hasSelectableAccounts(): boolean {
    return this.selectableAccounts.length > 0;
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get selectedOrgCount(): number {
    return this.accounts.filter(
      (a) => this.selectedIds.has(a.id) && this.isOrganization(a)
    ).length;
  }

  isProfile(account: SocialSelectorAccount): boolean {
    return account.accountType === 'profile';
  }

  isOrganization(account: SocialSelectorAccount): boolean {
    return account.accountType === 'organization';
  }

  getAccountTypeLabel(account: SocialSelectorAccount): string {
    return this.isProfile(account) ? 'Perfil personal' : 'Página de empresa';
  }

  isSelected(accountId: number): boolean {
    return this.selectedIds.has(accountId);
  }

  isConnected(account: SocialSelectorAccount): boolean {
    return account.status === 'Connected' || account.workspaceStatus === 'Connected';
  }

  isConnectingAccount(accountId: number): boolean {
    return this.connectingAccountIds.has(accountId);
  }

  getRowSuccessMessage(accountId: number): string | null {
    return this.rowSuccessMessages.get(accountId) ?? null;
  }

  hasOrgSlotAvailable(): boolean {
    if (this.remainingOrgSlots == null) return true;
    return this.remainingOrgSlots > 0;
  }

  canConnectOne(account: SocialSelectorAccount): boolean {
    if (this.isConnected(account)) return false;
    if (account.canConnect === false) return false;
    if (account.status === 'LimitBlocked') return false;
    if (this.isProfile(account)) return true;
    if (this.maxOrgSlots > 0 && this.remainingOrgSlots != null && this.remainingOrgSlots <= 0) {
      return false;
    }
    return true;
  }

  canSelectAccount(account: SocialSelectorAccount): boolean {
    if (!this.canConnectOne(account)) return false;
    if (this.selectedIds.has(account.id)) return true;
    if (this.isProfile(account)) return true;
    if (this.maxOrgSlots > 0 && this.remainingOrgSlots != null) {
      return this.selectedOrgCount < this.remainingOrgSlots;
    }
    return true;
  }

  toggleSelection(account: SocialSelectorAccount): void {
    if (!this.canSelectAccount(account) && !this.selectedIds.has(account.id)) return;

    if (this.selectedIds.has(account.id)) {
      this.selectedIds.delete(account.id);
      return;
    }

    if (this.isOrganization(account) && this.maxOrgSlots > 0 && this.remainingOrgSlots != null) {
      if (this.selectedOrgCount >= this.remainingOrgSlots) return;
    }

    this.selectedIds.add(account.id);
  }

  selectAllAvailable(): void {
    this.selectedIds.clear();
    for (const account of this.selectableAccounts) {
      if (this.isProfile(account)) {
        this.selectedIds.add(account.id);
        continue;
      }
      if (this.maxOrgSlots > 0 && this.remainingOrgSlots != null) {
        if (this.selectedOrgCount >= this.remainingOrgSlots) break;
      }
      this.selectedIds.add(account.id);
    }
  }

  connectOne(account: SocialSelectorAccount): void {
    if (this.connectionId == null || this.isConnectingAccount(account.id) || !this.canConnectOne(account)) {
      return;
    }

    this.connectingAccountIds.add(account.id);
    this.error = null;
    this.rowSuccessMessages.delete(account.id);

    this.social.connectAccount(account.id, this.connectionId).subscribe({
      next: (result) => {
        this.connectingAccountIds.delete(account.id);
        this.applyConnectResult(account.id, result, account);
        this.tenantEntitlements.refreshCurrentEntitlements().subscribe();
      },
      error: (err: unknown) => {
        this.connectingAccountIds.delete(account.id);
        alert(this.resolveError(err));
      }
    });
  }

  private applyConnectResult(
    accountId: number,
    result: SocialConnectAccountResponse,
    account: SocialSelectorAccount
  ): void {
    const index = this.accounts.findIndex((a) => a.id === accountId);
    if (index !== -1) {
      this.accounts[index] = {
        ...this.accounts[index],
        status: 'Connected',
        workspaceStatus: 'Connected',
        isActive: result.isActive ?? true,
        canConnect: false,
        canConnectReason: null
      };
    }

    this.selectedIds.delete(accountId);
    this.connectedThisSession += 1;

    if (this.isOrganization(account)) {
      if (result.remainingSlots != null) {
        this.applyOrgSlots(result.remainingSlots, this.maxOrgSlots, this.maxOrgSlots - result.remainingSlots);
      } else if (this.remainingOrgSlots != null) {
        this.remainingOrgSlots = Math.max(0, this.remainingOrgSlots - 1);
        this.activeOrgSlotsUsed += 1;
      }
    }

    const msg = result.message?.trim() || 'Cuenta conectada al workspace.';
    this.rowSuccessMessages.set(accountId, msg);
    this.successMessage = msg;
  }

  connectSelected(): void {
    if (this.connectionId == null || this.selectedIds.size === 0 || this.connecting) return;

    const ids = this.selectableAccounts.filter((a) => this.selectedIds.has(a.id)).map((a) => a.id);
    if (ids.length === 0) return;

    this.connecting = true;
    this.error = null;

    this.social.connectAccountsBulk(ids, this.connectionId).subscribe({
      next: (connected) => {
        this.connecting = false;
        this.tenantEntitlements.refreshCurrentEntitlements().subscribe();
        const count = connected.length;
        this.router.navigate([LinkedInAccountSelectComponent.LIST_ROUTE], {
          queryParams: {
            liAccountsConnected: count > 0 ? String(count) : undefined
          }
        });
      },
      error: (err: unknown) => {
        this.connecting = false;
        this.error = this.resolveError(err);
        this.loadSelector();
      }
    });
  }

  finishAndGoToList(): void {
    this.router.navigate([LinkedInAccountSelectComponent.LIST_ROUTE], {
      queryParams:
        this.connectedThisSession > 0
          ? { liAccountsConnected: String(this.connectedThisSession) }
          : undefined
    });
  }

  skipForNow(): void {
    this.finishAndGoToList();
  }

  isLimitBlocked(account: SocialSelectorAccount): boolean {
    return account.status === 'LimitBlocked';
  }

  onImageError(accountId: number): void {
    this.imageErrors.add(accountId);
  }

  hasImageError(accountId: number): boolean {
    return this.imageErrors.has(accountId);
  }

  formatUserId(externalUserId: string): string {
    const id = (externalUserId ?? '').trim();
    if (id.length <= 6) return id || 'LinkedIn';
    return `…${id.slice(-6)}`;
  }

  private resolveError(err: unknown): string {
    if (isSocialApiError(err)) {
      if (err.code?.startsWith('SOCIAL_ACCOUNT_')) {
        return getSocialAccountConnectErrorMessage(err.code);
      }
      if (err.code?.startsWith('SOCIAL_CONNECTION_') || err.code?.startsWith('LINKEDIN_')) {
        return getSocialLinkedInConnectionErrorMessage(err.code);
      }
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error al cargar las cuentas disponibles.';
  }
}
