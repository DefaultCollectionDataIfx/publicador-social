import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PublishAttempt } from '../../features/social/models/social.model';
import {
  PollPublishAttemptsOptions,
  SocialService
} from './social.service';

export type { PollPublishAttemptsOptions };

/**
 * @deprecated Use SocialService directly. Facade for backward compatibility.
 */
@Injectable({
  providedIn: 'root'
})
export class MetaPublishService {
  constructor(private social: SocialService) {}

  getPublishAttempts(postTargetId: number): Observable<PublishAttempt[]> {
    return this.social.getPublishAttempts(postTargetId);
  }

  pollPublishAttempts(
    postTargetId: number,
    options: PollPublishAttemptsOptions = {}
  ): Observable<PublishAttempt[]> {
    return this.social.pollPublishAttempts(postTargetId, options);
  }
}
