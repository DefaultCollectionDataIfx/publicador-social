import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetaConnectService } from '../../../core/services/meta-connect.service';
import { MetaConnectionType } from '../../../features/meta/models/meta.model';
import { SocialConnectionType } from '../../../features/social/models/social.model';
import {
  getSocialConnectionErrorMessage,
  getSocialInstagramConnectionErrorMessage,
  isSocialApiError
} from '../../../shared/utils/social-api.error';

@Component({
  selector: 'app-meta-connect',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meta-connect.component.html',
  styleUrl: './meta-connect.component.scss'
})
export class MetaConnectComponent {
  @Input() connectionType: MetaConnectionType = 'facebook_login';
  @Input() label = 'Conectar';
  /** Redirect completo al callback SPA (FB selector / IG lista). */
  @Input() useRedirect = true;
  @Input() oauthMode?: 'add' | 'reauth';
  @Input() connectionId?: number;
  @Input() maxConnectionsPerTenant?: number;
  @Input() maxInstagramAccounts?: number;

  @Output() connectionSuccess = new EventEmitter<SocialConnectionType>();
  @Output() connectionError = new EventEmitter<string>();

  loading = false;
  errorMessage: string | null = null;

  constructor(private metaConnect: MetaConnectService) {}

  get isInstagram(): boolean {
    return this.connectionType === 'instagram_login';
  }

  get usesRedirect(): boolean {
    return this.useRedirect;
  }

  onConnect(): void {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.errorMessage = null;

    const options = this.buildConnectOptions();

    if (this.usesRedirect) {
      const redirect$ =
        this.connectionType === 'instagram_login'
          ? this.metaConnect.connectInstagramWithRedirect(options)
          : this.metaConnect.connectFacebookWithRedirect(options);

      redirect$.subscribe({
        error: (err: unknown) => {
          this.loading = false;
          const msg = this.resolveErrorMessage(err);
          this.errorMessage = msg;
          this.connectionError.emit(msg);
        }
      });
      return;
    }

    const flow$ =
      this.connectionType === 'instagram_login'
        ? this.metaConnect.connectInstagramWithPopup(options)
        : this.metaConnect.connectFacebookWithPopup(options);

    flow$.subscribe({
      next: (result) => {
        this.loading = false;
        if (result.success) {
          this.connectionSuccess.emit(this.connectionType as SocialConnectionType);
        } else {
          const msg = 'La autorización no se completó. Intenta de nuevo.';
          this.errorMessage = msg;
          this.connectionError.emit(msg);
        }
      },
      error: (err: unknown) => {
        this.loading = false;
        const msg = this.resolveErrorMessage(err);
        this.errorMessage = msg;
        this.connectionError.emit(msg);
      }
    });
  }

  private buildConnectOptions() {
    if (this.oauthMode || this.connectionId != null) {
      return {
        mode: this.oauthMode ?? (this.connectionId != null ? ('reauth' as const) : ('add' as const)),
        connectionId: this.connectionId
      };
    }
    return { mode: 'add' as const };
  }

  private resolveErrorMessage(err: unknown): string {
    if (isSocialApiError(err)) {
      if (this.isInstagram) {
        return getSocialInstagramConnectionErrorMessage(err.code, {
          maxConnectionsPerTenant: this.maxConnectionsPerTenant,
          maxInstagramAccounts: this.maxInstagramAccounts
        });
      }
      const connectionMsg = getSocialConnectionErrorMessage(err.code, this.maxConnectionsPerTenant);
      if (err.code?.startsWith('SOCIAL_')) {
        return connectionMsg;
      }
      return err.message || connectionMsg;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error al conectar.';
  }
}
