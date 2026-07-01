import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  CreatePostPlanRequest,
  CreatePostPlanResponse,
  PostPlanDetailsResponse,
  PostPlanListResponse,
  PublishAttempt
} from '../models/post-plan.model';
import { SocialService } from '../../../core/services/social.service';
import { CreateSocialPostPlanRequest } from '../../social/models/social.model';

@Injectable({
  providedIn: 'root'
})
export class PostPlanService {
  constructor(private social: SocialService) {}

  createPostPlan(request: CreatePostPlanRequest): Observable<CreatePostPlanResponse> {
    const body = this.toSocialRequest(request);
    return this.social.createPostPlan(body);
  }

  getPostPlanDetails(planId: number): Observable<PostPlanDetailsResponse> {
    return this.social.getPostPlanDetails(planId);
  }

  getPostPlans(
    start: Date,
    end: Date,
    status?: string,
    onlyWithPublishableTargets?: boolean,
    q?: string
  ): Observable<PostPlanListResponse> {
    return this.social.getPostPlans(start, end, status, onlyWithPublishableTargets, q);
  }

  getPublishAttempts(postTargetId: number): Observable<PublishAttempt[]> {
    return this.social.getPublishAttempts(postTargetId);
  }

  private toSocialRequest(request: CreatePostPlanRequest): CreateSocialPostPlanRequest {
    const body: CreateSocialPostPlanRequest = {
      scheduledAt: request.scheduledAt,
      timezone: request.timezone,
      message: request.message
    };

    if (request.linkUrl) body.linkUrl = request.linkUrl;
    if (request.imageUrl) body.imageUrl = request.imageUrl;
    if (request.dedupeKey) body.dedupeKey = request.dedupeKey;
    if (request.destinations?.length) body.destinations = request.destinations;
    if (request.planMedia?.length) body.planMedia = request.planMedia;

    if (request.providerOptions) {
      body.providerOptions = request.providerOptions;
    } else if (request.instagramContentType) {
      const raw = request.instagramContentType;
      const contentType = raw === 'reels' ? 'reel' : raw;
      body.providerOptions = {
        instagram: {
          contentType: contentType as 'image' | 'carousel' | 'video' | 'reel',
          publishAsReels: request.instagramPublishAsReels
        }
      };
    }

    return body;
  }

  private handleError = (error: HttpErrorResponse) => {
    let errorMessage = 'Error desconocido';

    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      switch (error.status) {
        case 400:
          errorMessage =
            error.error?.detail || error.error?.message || 'Solicitud inválida. Verifica los datos ingresados.';
          break;
        case 401:
          errorMessage = 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
          break;
        case 500:
          errorMessage = 'Error del servidor. Por favor, intenta más tarde.';
          break;
        default:
          errorMessage =
            error.error?.detail || error.error?.message || `Error ${error.status}: ${error.message}`;
      }
    }

    return throwError(() => new Error(errorMessage));
  };
}
