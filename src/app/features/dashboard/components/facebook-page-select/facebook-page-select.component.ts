import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { SocialService } from '../../../../core/services/social.service';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import {
  getSocialAccountConnectErrorMessage,
  getSocialConnectionErrorMessage,
  isSocialApiError
} from '../../../../shared/utils/social-api.error';
import {
  SocialConnection,
  SocialConnectAccountResponse,
  SocialSelectorAccount
} from '../../../social/models/social.model';

@Component({
  selector: 'app-facebook-page-select',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './facebook-page-select.component.html',
  styleUrl: './facebook-page-select.component.scss'
})
export class FacebookPageSelectComponent implements OnInit {
  private static readonly LIST_ROUTE = '/dashboard/cuentas-conectadas';

  connectionId: number | null = null;
  connection: SocialConnection | null = null;
  accounts: SocialSelectorAccount[] = [];
  selectedIds = new Set<number>();
  remainingSlots = 0;
  maxSlots = 0;
  activeSlotsUsed = 0;
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
        this.router.navigate([FacebookPageSelectComponent.LIST_ROUTE], {
          queryParams: { fbError: 'missing_connection' }
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
        this.postOAuthMessage = `${count} página${count === 1 ? '' : 's'} encontrada${count === 1 ? '' : 's'} en Meta.`;
      }
    }

    const warning = params.get('warning');
    if (warning === 'SYNC_NO_PAGES_RETURNED') {
      this.postOAuthWarning =
        'La autorización fue exitosa, pero Meta no devolvió páginas para esta cuenta.';
    }

    const fbError = params.get('fbError');
    if (fbError) {
      this.postOAuthError = fbError.startsWith('SOCIAL_')
        ? getSocialConnectionErrorMessage(fbError)
        : 'No se pudo completar la conexión con Meta.';
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
        this.applySlots(data.remainingSlots ?? 0, data.maxSlots ?? 0, data.activeSlotsUsed ?? 0);
        this.loading = false;
      },
      error: (err: unknown) => {
        this.loading = false;
        this.error = this.resolveError(err);
      }
    });
  }

  private applySlots(remainingSlots: number, maxSlots: number, activeSlotsUsed: number): void {
    this.remainingSlots = remainingSlots;
    this.maxSlots = maxSlots;
    this.activeSlotsUsed = activeSlotsUsed;
    if (maxSlots > 0 && activeSlotsUsed === 0 && remainingSlots <= maxSlots) {
      this.activeSlotsUsed = maxSlots - remainingSlots;
    }
  }

  get connectionLabel(): string {
    if (!this.connection) return 'Cuenta Meta';
    return this.connection.displayLabel?.trim() || this.formatMetaUserId(this.connection.externalUserId);
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

  canConnectOne(account: SocialSelectorAccount): boolean {
    if (this.isConnected(account)) return false;
    if (account.canConnect === false) return false;
    if (account.status === 'LimitBlocked') return false;
    if (this.remainingSlots <= 0) return false;
    return true;
  }

  canSelectAccount(account: SocialSelectorAccount): boolean {
    if (!this.canConnectOne(account)) return false;
    if (this.selectedIds.has(account.id)) return true;
    return this.selectedIds.size < this.remainingSlots;
  }

  toggleSelection(account: SocialSelectorAccount): void {
    if (!this.canSelectAccount(account)) return;

    if (this.selectedIds.has(account.id)) {
      this.selectedIds.delete(account.id);
      return;
    }

    if (this.selectedIds.size >= this.remainingSlots) {
      return;
    }

    this.selectedIds.add(account.id);
  }

  selectAllAvailable(): void {
    this.selectedIds.clear();
    for (const account of this.selectableAccounts) {
      if (this.selectedIds.size >= this.remainingSlots) break;
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
        this.applyConnectResult(account.id, result);
        this.tenantEntitlements.refreshCurrentEntitlements().subscribe();
      },
      error: (err: unknown) => {
        this.connectingAccountIds.delete(account.id);
        alert(this.resolveError(err));
      }
    });
  }

  private applyConnectResult(accountId: number, result: SocialConnectAccountResponse): void {
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

    if (result.remainingSlots != null) {
      this.applySlots(result.remainingSlots, this.maxSlots, this.maxSlots - result.remainingSlots);
    } else {
      this.remainingSlots = Math.max(0, this.remainingSlots - 1);
      this.activeSlotsUsed += 1;
    }

    const msg = result.message?.trim() || 'Página conectada al workspace.';
    this.rowSuccessMessages.set(accountId, msg);
    this.successMessage = msg;
  }

  connectSelected(): void {
    if (this.connectionId == null || this.selectedIds.size === 0 || this.connecting) return;

    const ids = this.selectableAccounts
      .filter((a) => this.selectedIds.has(a.id))
      .map((a) => a.id);

    if (ids.length === 0) return;

    this.connecting = true;
    this.error = null;

    this.social.connectAccountsBulk(ids, this.connectionId).subscribe({
      next: (connected) => {
        this.connecting = false;
        this.tenantEntitlements.refreshCurrentEntitlements().subscribe();
        const count = connected.length;
        this.router.navigate([FacebookPageSelectComponent.LIST_ROUTE], {
          queryParams: {
            pagesConnected: count > 0 ? String(count) : undefined
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
    this.router.navigate([FacebookPageSelectComponent.LIST_ROUTE], {
      queryParams: this.connectedThisSession > 0
        ? { pagesConnected: String(this.connectedThisSession) }
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

  formatMetaUserId(externalUserId: string): string {
    const id = (externalUserId ?? '').trim();
    if (id.length <= 6) return id || 'Meta';
    return `…${id.slice(-6)}`;
  }

  private resolveError(err: unknown): string {
    if (isSocialApiError(err)) {
      if (err.code?.startsWith('SOCIAL_ACCOUNT_')) {
        return getSocialAccountConnectErrorMessage(err.code);
      }
      if (err.code?.startsWith('SOCIAL_CONNECTION_')) {
        return getSocialConnectionErrorMessage(err.code);
      }
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error al cargar las páginas disponibles.';
  }
}
