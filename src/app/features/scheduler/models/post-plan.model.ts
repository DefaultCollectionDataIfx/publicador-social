// Modelos para planes de publicación (PostPlan)

import {
  PlanMediaItem,
  PostDestination,
  ProviderOptionsInstagram,
  ProviderOptionsLinkedIn,
  PublishAttempt
} from '../../social/models/social.model';

export interface CreatePostPlanRequest {
  scheduledAt: string;
  timezone: string;
  message: string;
  linkUrl?: string;
  imageUrl?: string;
  dedupeKey?: string;
  destinations?: PostDestination[];
  planMedia?: PlanMediaItem[];
  providerOptions?: {
    instagram?: ProviderOptionsInstagram;
    linkedin?: ProviderOptionsLinkedIn;
  };
  /** @deprecated Use destinations + planMedia */
  mediaId?: number;
  /** @deprecated Use destinations */
  pageIds?: string[];
  /** @deprecated Use providerOptions.instagram */
  instagramContentType?: string;
  /** @deprecated Use providerOptions.instagram.publishAsReels */
  instagramPublishAsReels?: boolean;
}

export interface CreatePostPlanResponse {
  data: {
    planId: number;
    targetsCreated: number;
    targetsSkipped: number;
    message: string;
  };
  meta: {
    totalCount: number;
    pageSize: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviusPage: boolean;
    nextPageUrl: string;
    previusPageUrl: string;
  };
}

export enum PostTargetStatus {
  Pending = 0,
  Published = 1,
  Failed = 2,
  Skipped = 3
}

export interface PostTarget {
  postTargetId?: number;
  facebookPageId?: string;
  externalAccountId?: string;
  managedSocialAccountId?: number;
  provider?: string;
  name: string;
  status: PostTargetStatus | string;
  lastError?: string;
  errorCode?: string;
  attemptCount: number;
  lastAttemptAt?: string;
}

export type { PublishAttempt };

export interface PostPlanDetails {
  id: number;
  message: string;
  linkUrl?: string;
  imageUrl?: string;
  scheduledAt: string;
  timezone: string;
  createdAt: string;
  targets: PostTarget[];
}

export interface PostPlanDetailsResponse {
  data: PostPlanDetails;
  meta: {
    totalCount: number;
    pageSize: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviusPage: boolean;
    nextPageUrl: string;
    previusPageUrl: string;
  };
}

export interface PostPlanTargetsSummary {
  total: number;
  pending: number;
  published: number;
  failed: number;
  skipped: number;
}

export type PostPlanStatus = 'Pending' | 'Published' | 'Failed' | 'Partial' | 'Canceled';

export interface PostPlanListItem {
  id: number;
  scheduledAt: string;
  timezone: string;
  createdAt: string;
  title: string;
  status: PostPlanStatus;
  targetsSummary: PostPlanTargetsSummary;
  hasLink: boolean;
  hasImage: boolean;
}

export interface PostPlanListResponse {
  data: PostPlanListItem[];
  meta?: {
    totalCount?: number;
    pageSize?: number;
    currentPage?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPreviusPage?: boolean;
    nextPageUrl?: string;
    previusPageUrl?: string;
  };
}
