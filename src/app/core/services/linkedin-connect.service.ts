import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  SocialConnectStartOptions,
  SocialConnection,
  SocialSyncResponse
} from '../../features/social/models/social.model';
import { SocialService } from './social.service';

@Injectable({
  providedIn: 'root'
})
export class LinkedInConnectService {
  constructor(private social: SocialService) {}

  startLinkedInConnect(options?: SocialConnectStartOptions): Observable<string> {
    return this.social.startConnect('linkedin', 'linkedin_oauth', options);
  }

  getLinkedInConnections(): Observable<SocialConnection[]> {
    return this.social.getConnections({
      providerGroup: 'linkedin',
      connectionType: 'linkedin_oauth',
      isActive: true
    });
  }

  syncLinkedInConnection(connectionId: number): Observable<SocialSyncResponse> {
    return this.social.syncConnection(connectionId);
  }

  disconnectLinkedInConnection(connectionId: number): Observable<{ message?: string }> {
    return this.social.disconnectConnection(connectionId);
  }

  connectLinkedInWithRedirect(options?: SocialConnectStartOptions): Observable<never> {
    return this.social.startLinkedInConnectRedirect(options);
  }

  reauthLinkedInConnection(connectionId: number): Observable<never> {
    return this.social.startLinkedInConnectRedirect({ mode: 'reauth', connectionId });
  }

  disconnectAll(): Observable<{ message?: string }> {
    return this.social.disconnect('linkedin', 'linkedin_oauth');
  }
}
