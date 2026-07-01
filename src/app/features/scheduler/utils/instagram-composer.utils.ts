import { environment } from '../../../../environments/environment';
import {
  InstagramContentType,
  MetaCapabilities,
  MetaManagedAccount,
  PlanMediaItem,
  PlanMediaRole
} from '../../meta/models/meta.model';

export interface ComposerMediaSelection {
  composerMediaId: number;
  mimeType: string;
  publicUrl?: string;
  name?: string;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}

export function inferInstagramContentType(
  items: ComposerMediaSelection[],
  publishAsReel: boolean
): InstagramContentType {
  if (items.length >= 2) {
    return 'carousel';
  }
  if (items.length === 1) {
    if (isVideoMime(items[0].mimeType)) {
      return publishAsReel ? 'reels' : 'video';
    }
    return 'image';
  }
  return 'image';
}

export function buildPlanMedia(items: ComposerMediaSelection[]): PlanMediaItem[] {
  const role: PlanMediaRole = items.length >= 2 ? 'carousel_item' : 'primary';
  return items.map((item, index) => ({
    composerMediaId: item.composerMediaId,
    sortOrder: index,
    mediaRole: role
  }));
}

export function validateInstagramMediaSelection(
  items: ComposerMediaSelection[],
  allowMixedCarousel = environment.metaAllowMixedCarousel
): string | null {
  if (items.length === 0) {
    return 'Instagram requiere al menos una imagen o video.';
  }
  if (items.length === 1) {
    return null;
  }
  if (items.length < 2 || items.length > 10) {
    return 'El carrusel debe tener entre 2 y 10 elementos.';
  }
  const hasVideo = items.some((i) => isVideoMime(i.mimeType));
  const hasImage = items.some((i) => isImageMime(i.mimeType));
  if (hasVideo && !allowMixedCarousel) {
    return 'El carrusel mixto (imagen + video) no está habilitado en este entorno.';
  }
  if (hasVideo && !hasImage) {
    return 'El carrusel debe incluir al menos una imagen si contiene videos.';
  }
  return null;
}

export function buildInstagramProviderOptions(
  items: ComposerMediaSelection[],
  publishAsReel: boolean
): import('../../social/models/social.model').ProviderOptionsInstagram {
  const contentType = inferInstagramContentType(items, publishAsReel);
  const mapped =
    contentType === 'reels' ? 'reel' : (contentType as 'image' | 'carousel' | 'video');
  return {
    contentType: mapped,
    publishAsReels: publishAsReel && (contentType === 'video' || contentType === 'reels')
  };
}

export function isInstagramAccountSelectable(account: MetaManagedAccount): boolean {
  if (!account.isActive) return false;
  if (!account.canPublish || account.requiresReconnect) return false;
  if (account.publishingQuota && !account.publishingQuota.canPublish) return false;
  return true;
}

export function accountSupportsContentType(
  account: MetaManagedAccount,
  contentType: InstagramContentType
): boolean {
  const caps = account.capabilities;
  if (!caps) return true;
  switch (contentType) {
    case 'carousel':
      return caps.canPublishCarousel;
    case 'video':
      return caps.canPublishVideo;
    case 'reels':
      return caps.canPublishReels;
    default:
      return caps.canPublishImage;
  }
}

export function getCapabilityLabel(caps: MetaCapabilities): string[] {
  const labels: string[] = [];
  if (caps.canPublishImage) labels.push('Imagen');
  if (caps.canPublishCarousel) labels.push('Carrusel');
  if (caps.canPublishVideo) labels.push('Video');
  if (caps.canPublishReels) labels.push('Reels');
  return labels;
}
