import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';
import { PostPlanService } from '../../services/post-plan.service';
import { PostPlanDetails, PostTarget, PostTargetStatus } from '../../models/post-plan.model';
import { PublishAttempt } from '../../../meta/models/meta.model';
import { extractErrorMessage } from '../../../../shared/utils/error.utils';
import { getPublishStatusLabel } from '../../../../shared/utils/meta-error.utils';

export { PostTargetStatus };

interface TargetPublishState {
  attempts: PublishAttempt[];
  loading: boolean;
  error: string | null;
}

@Component({
  selector: 'app-post-plan-details',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './post-plan-details.component.html',
  styleUrl: './post-plan-details.component.scss'
})
export class PostPlanDetailsComponent implements OnInit, OnDestroy {
  @Input() planId!: number;

  planDetails: PostPlanDetails | null = null;
  loading = true;
  error: string | null = null;
  PostTargetStatus = PostTargetStatus;
  publishStateByTarget = new Map<number, TargetPublishState>();
  private subscriptions = new Subscription();

  constructor(private postPlanService: PostPlanService) {}

  ngOnInit(): void {
    if (this.planId) {
      this.loadPlanDetails();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadPlanDetails(): void {
    this.loading = true;
    this.error = null;
    this.publishStateByTarget.clear();

    const detailsSubscription = this.postPlanService.getPostPlanDetails(this.planId).subscribe({
      next: (response) => {
        this.planDetails = response.data;
        this.loading = false;
        this.startPublishPollingForTargets();
      },
      error: (error) => {
        this.error = extractErrorMessage(
          error,
          'Error al cargar los detalles del plan. Por favor, intenta nuevamente.'
        );
        this.loading = false;
      }
    });

    this.subscriptions.add(detailsSubscription);
  }

  private startPublishPollingForTargets(): void {
    if (!this.planDetails) return;

    for (const target of this.planDetails.targets) {
      const postTargetId = target.postTargetId;
      if (!postTargetId) continue;

      const status = this.normalizeStatus(target.status);
      if (!this.shouldPollPublish(status)) continue;

      this.publishStateByTarget.set(postTargetId, { attempts: [], loading: true, error: null });

      const pollSub = interval(4000)
        .pipe(
          startWith(0),
          switchMap(() => this.postPlanService.getPublishAttempts(postTargetId))
        )
        .subscribe({
          next: (attempts) => {
            this.publishStateByTarget.set(postTargetId, { attempts, loading: false, error: null });
            const latest = attempts[attempts.length - 1];
            if (latest && (latest.status === 'success' || latest.status === 'failed')) {
              pollSub.unsubscribe();
            }
          },
          error: (err: Error) => {
            this.publishStateByTarget.set(postTargetId, {
              attempts: [],
              loading: false,
              error: err.message
            });
          }
        });

      this.subscriptions.add(pollSub);
    }
  }

  private shouldPollPublish(status: string): boolean {
    return status === 'Publishing' || status === 'RetryPending' || status === 'Pending';
  }

  private normalizeStatus(status: PostTargetStatus | string): string {
    if (typeof status === 'string') return status;
    const map: Record<PostTargetStatus, string> = {
      [PostTargetStatus.Pending]: 'Pending',
      [PostTargetStatus.Published]: 'Published',
      [PostTargetStatus.Failed]: 'Failed',
      [PostTargetStatus.Skipped]: 'Skipped'
    };
    return map[status] ?? 'Pending';
  }

  getStatusLabel(status: PostTargetStatus | string): string {
    if (typeof status === 'string') {
      return getPublishStatusLabel(status);
    }
    const labels: Record<PostTargetStatus, string> = {
      [PostTargetStatus.Pending]: 'Pendiente',
      [PostTargetStatus.Published]: 'Publicado',
      [PostTargetStatus.Failed]: 'Fallido',
      [PostTargetStatus.Skipped]: 'Omitido'
    };
    return labels[status] || 'Desconocido';
  }

  getStatusClass(status: PostTargetStatus | string): string {
    const normalized = this.normalizeStatus(status);
    const classes: Record<string, string> = {
      Pending: 'status-pending',
      Publishing: 'status-pending',
      RetryPending: 'status-pending',
      Published: 'status-published',
      Failed: 'status-failed',
      Skipped: 'status-skipped',
      Cancelled: 'status-skipped'
    };
    return classes[normalized] || 'status-unknown';
  }

  getStatusIcon(status: PostTargetStatus | string): string {
    const normalized = this.normalizeStatus(status);
    const icons: Record<string, string> = {
      Pending: '⏳',
      Publishing: '🔄',
      RetryPending: '⏸️',
      Published: '✅',
      Failed: '❌',
      Skipped: '⏭️',
      Cancelled: '🚫'
    };
    return icons[normalized] || '❓';
  }

  getTargetIdLabel(target: PostTarget): string {
    if (target.facebookPageId) {
      return `FB Page: ${target.facebookPageId}`;
    }
    if (target.managedSocialAccountId) {
      return `IG Account: ${target.managedSocialAccountId}`;
    }
    return target.provider ? `Provider: ${target.provider}` : 'Sin ID';
  }

  getPublishState(target: PostTarget): TargetPublishState | null {
    if (!target.postTargetId) return null;
    return this.publishStateByTarget.get(target.postTargetId) ?? null;
  }

  getLatestAttempt(target: PostTarget): PublishAttempt | null {
    const state = this.getPublishState(target);
    if (!state?.attempts.length) return null;
    return state.attempts[state.attempts.length - 1];
  }

  formatDate(dateString: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getTargetsByStatus(status: PostTargetStatus): PostTarget[] {
    if (!this.planDetails) return [];
    return this.planDetails.targets.filter((target) => target.status === status);
  }

  getTotalTargets(): number {
    return this.planDetails?.targets.length || 0;
  }
}
