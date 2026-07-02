import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LinkedInConnectService } from '../../../core/services/linkedin-connect.service';
import {
  getSocialLinkedInConnectionErrorMessage,
  isSocialApiError
} from '../../../shared/utils/social-api.error';

@Component({
  selector: 'app-linkedin-connect',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './linkedin-connect.component.html',
  styleUrl: './linkedin-connect.component.scss'
})
export class LinkedInConnectComponent {
  @Input() label = 'Conectar';
  @Input() oauthMode?: 'add' | 'reauth';
  @Input() connectionId?: number;
  @Input() maxConnectionsPerTenant?: number;
  @Input() maxLinkedInOrganizations?: number;

  @Output() connectionSuccess = new EventEmitter<void>();
  @Output() connectionError = new EventEmitter<string>();

  loading = false;
  errorMessage: string | null = null;

  constructor(private linkedInConnect: LinkedInConnectService) {}

  onConnect(): void {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.errorMessage = null;

    const options = this.buildConnectOptions();

    this.linkedInConnect.connectLinkedInWithRedirect(options).subscribe({
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
      return getSocialLinkedInConnectionErrorMessage(err.code, {
        maxConnectionsPerTenant: this.maxConnectionsPerTenant,
        maxLinkedInOrganizations: this.maxLinkedInOrganizations
      });
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error al conectar LinkedIn.';
  }
}
