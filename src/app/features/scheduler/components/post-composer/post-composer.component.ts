import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  FormsModule,
  Validators
} from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { PostPlanService } from '../../services/post-plan.service';
import { CreatePostPlanRequest } from '../../models/post-plan.model';
import { MetaConnectService } from '../../../../core/services/meta-connect.service';
import { SocialService } from '../../../../core/services/social.service';
import { SocialAccount } from '../../../social/models/social.model';
import { TenantEntitlementsResponse } from '../../../../core/models/tenant.model';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import { canUseLimit, getLimitValue, isFeatureEnabled } from '../../../../core/utils/entitlements.utils';
import { FacebookPage } from '../../../facebook/models/facebook.model';
import { markFormGroupTouched, isFieldInvalid } from '../../../../shared/utils/form.utils';
import { extractMetaError } from '../../../../shared/utils/meta-error.utils';
import { getFieldError } from '../../../../shared/utils/validation.utils';
import {
  accountSupportsContentType,
  buildInstagramProviderOptions,
  buildPlanMedia,
  ComposerMediaSelection,
  inferInstagramContentType,
  isInstagramAccountSelectable,
  validateInstagramMediaSelection
} from '../../utils/instagram-composer.utils';
import { environment } from '../../../../../environments/environment';
import {
  PostComposerMediaPanelComponent,
  MediaAppliedPayload,
  MediaPanelTab
} from './media/post-composer-media-panel.component';
import { MediaSelectionService } from '../../../media/services/media-selection.service';

const DRAFT_STORAGE_KEY = 'publicador.postComposer.draft.v1';

export type PreviewNetworkId = 'facebook' | 'instagram' | 'linkedin';

interface ComposerDraftPayload {
  scheduledAt: string;
  timezone: string;
  message: string;
  linkUrl: string;
  imageUrl: string;
  mediaId?: number | null;
  pageIds: string[];
  facebookAccountIds: number[];
  instagramAccountIds: number[];
  planMedia: ComposerMediaSelection[];
  publishAsReel: boolean;
  previewNetwork: PreviewNetworkId;
  dedupeKey: string;
  publishMode: 'now' | 'schedule';
  savedAt: string;
}

@Component({
  selector: 'app-post-composer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PostComposerMediaPanelComponent],
  templateUrl: './post-composer.component.html',
  styleUrl: './post-composer.component.scss'
})
export class PostComposerComponent implements OnInit, OnDestroy {
  @Input() initialDate?: string;
  @Output() success = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('messageTextarea') messageTextarea?: ElementRef<HTMLTextAreaElement>;

  postPlanForm!: FormGroup;
  pages: FacebookPage[] = [];
  facebookAccounts: SocialAccount[] = [];
  facebookAccountIds: number[] = [];
  instagramAccounts: SocialAccount[] = [];
  loadingPages = true;
  loadingInstagram = false;
  instagramAccountIds: number[] = [];
  planMediaItems: ComposerMediaSelection[] = [];
  publishAsReel = true;
  isLoading = false;
  errorMessage = '';
  entitlements: TenantEntitlementsResponse['data'] | null = null;
  canCreatePostPlan = true;
  limitGateErrorMessage: string | null = null;
  private subscriptions = new Subscription();

  /** Vista previa: red activa en pestañas */
  previewNetwork: PreviewNetworkId = 'facebook';

  /** Móvil: pestaña del stepper */
  mobileTab: 'accounts' | 'editor' | 'preview' = 'editor';

  /** Modo de publicación (editor); el footer puede forzar con onSubmit */
  publishMode: 'now' | 'schedule' = 'schedule';

  draftSavedHint = false;
  showEmojiPanel = false;

  showMediaPanel = false;
  mediaPanelInitialTab: MediaPanelTab = 'device';
  mediaPanelPendingFile: File | null = null;
  private hasPendingSelection = false;

  readonly charLimitFacebook = 5000;
  readonly charLimitInstagram = 2200;
  placeholderNetworks: { id: PreviewNetworkId; label: string; available: boolean }[] = [
    { id: 'facebook', label: 'Facebook', available: true },
    { id: 'instagram', label: 'Instagram', available: false },
    { id: 'linkedin', label: 'LinkedIn', available: false }
  ];

  readonly quickEmojis = [
    '😀', '😂', '❤️', '👍', '🔥', '✨', '🎉', '💡', '🙌', '👏',
    '😊', '🤔', '😮', '🙏', '💪', '📌', '✅', '⭐', '💬', '📸'
  ];

  timezones = [
    { value: 'America/Bogota', label: 'Bogotá (GMT-5)' },
    { value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)' },
    { value: 'America/Santiago', label: 'Santiago (GMT-3)' },
    { value: 'America/Lima', label: 'Lima (GMT-5)' },
    { value: 'America/Caracas', label: 'Caracas (GMT-4)' },
    { value: 'America/New_York', label: 'Nueva York (GMT-5)' },
    { value: 'America/Los_Angeles', label: 'Los Ángeles (GMT-8)' },
    { value: 'Europe/Madrid', label: 'Madrid (GMT+1)' },
    { value: 'UTC', label: 'UTC (GMT+0)' }
  ];

  constructor(
    private fb: FormBuilder,
    private postPlanService: PostPlanService,
    private metaConnect: MetaConnectService,
    private social: SocialService,
    private tenantEntitlements: TenantEntitlementsService,
    private mediaSelection: MediaSelectionService
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.consumePendingMediaSelection();
    // Si el usuario abrió desde una fecha del calendario, no pisar con borrador local.
    if (!this.initialDate && !this.hasPendingSelection) {
      this.tryRestoreDraft();
    }
    this.loadPages();
    this.loadInstagramAccounts();
    this.refreshEntitlements();
    this.setupAutosave();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.showEmojiPanel) return;
    const t = ev.target as HTMLElement;
    if (t.closest('.emoji-panel-wrap')) return;
    this.showEmojiPanel = false;
  }

  initForm(): void {
    let initialDateTime = '';
    if (this.initialDate) {
      const date = new Date(this.initialDate);
      initialDateTime = this.toDatetimeLocalValue(date);
    } else {
      const now = new Date();
      now.setHours(now.getHours() + 1);
      initialDateTime = this.toDatetimeLocalValue(now);
    }

    this.postPlanForm = this.fb.group({
      scheduledAt: [initialDateTime, [Validators.required]],
      timezone: ['America/Bogota', [Validators.required]],
      message: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(this.charLimitFacebook)]],
      linkUrl: [''],
      imageUrl: [''],
      mediaId: [null as number | null],
      dedupeKey: ['']
    });
  }

  private toDatetimeLocalValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private setupAutosave(): void {
    const sub = this.postPlanForm.valueChanges
      .pipe(debounceTime(900), distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)))
      .subscribe(() => this.persistDraft());
    this.subscriptions.add(sub);
  }

  private tryRestoreDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as ComposerDraftPayload;
      if (!d || typeof d.message !== 'string') return;
      this.postPlanForm.patchValue({
        scheduledAt: d.scheduledAt || this.postPlanForm.get('scheduledAt')?.value,
        timezone: d.timezone || 'America/Bogota',
        message: d.message,
        linkUrl: d.linkUrl || '',
        imageUrl: d.imageUrl || '',
        mediaId: d.mediaId != null ? d.mediaId : null,
        dedupeKey: d.dedupeKey || ''
      });
      this.facebookAccountIds = Array.isArray(d.facebookAccountIds)
        ? d.facebookAccountIds
        : [];
      this.instagramAccountIds = Array.isArray(d.instagramAccountIds) ? d.instagramAccountIds : [];
      this.planMediaItems = Array.isArray(d.planMedia) ? d.planMedia : [];
      this.publishAsReel = d.publishAsReel !== false;
      if (d.previewNetwork === 'facebook' || d.previewNetwork === 'instagram') {
        this.previewNetwork = d.previewNetwork;
      }
      if (d.publishMode === 'now' || d.publishMode === 'schedule') {
        this.publishMode = d.publishMode;
      }
    } catch {
      /* ignore */
    }
  }

  private consumePendingMediaSelection(): void {
    const pending = this.mediaSelection.consumePendingSelection();
    if (!pending) return;
    this.hasPendingSelection = true;
    this.postPlanForm.patchValue({
      mediaId: pending.mediaId,
      imageUrl: pending.publicUrl ?? ''
    });
  }

  persistDraft(): void {
    if (!this.postPlanForm) return;
    const v = this.postPlanForm.value;
    const payload: ComposerDraftPayload = {
      scheduledAt: v.scheduledAt,
      timezone: v.timezone,
      message: v.message || '',
      linkUrl: v.linkUrl || '',
      imageUrl: v.imageUrl || '',
      mediaId: v.mediaId != null ? v.mediaId : null,
      pageIds: [],
      facebookAccountIds: this.facebookAccountIds,
      instagramAccountIds: this.instagramAccountIds,
      planMedia: this.planMediaItems,
      publishAsReel: this.publishAsReel,
      previewNetwork: this.previewNetwork,
      dedupeKey: v.dedupeKey || '',
      publishMode: this.publishMode,
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota */
    }
  }

  clearDraftStorage(): void {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* */
    }
  }

  onSaveDraftClick(): void {
    this.persistDraft();
    this.draftSavedHint = true;
    setTimeout(() => (this.draftSavedHint = false), 2500);
  }

  loadPages(): void {
    this.loadingPages = true;
    const pagesSubscription = this.social
      .getAccounts({
        providerGroup: 'meta',
        provider: 'facebook',
        accountType: 'page',
        forPublishing: true
      })
      .subscribe({
        next: (accounts) => {
          this.facebookAccounts = accounts.filter((a) => a.isActive && a.canPublish);
          this.pages = this.facebookAccounts.map((a) => this.social.accountToFacebookPage(a));
          this.loadingPages = false;
          this.updatePostPlanGate();
        },
      error: () => {
        this.loadingPages = false;
        this.errorMessage = 'Error al cargar las páginas de Facebook. Por favor, intenta nuevamente.';
      }
    });
    this.subscriptions.add(pagesSubscription);
  }

  loadInstagramAccounts(): void {
    this.loadingInstagram = true;
    const sub = this.metaConnect
      .getAccounts({ forPublishing: true, includeQuota: true, provider: 'instagram' })
      .subscribe({
        next: (accounts) => {
          this.instagramAccounts = accounts;
          this.loadingInstagram = false;
          this.updatePostPlanGate();
        },
        error: () => {
          this.loadingInstagram = false;
        }
      });
    this.subscriptions.add(sub);
  }

  get isInstagramMode(): boolean {
    return this.previewNetwork === 'instagram';
  }

  get mediaPanelMultiSelect(): boolean {
    return this.isInstagramMode;
  }

  private refreshEntitlements(): void {
    const sub = this.tenantEntitlements.refreshCurrentEntitlements().subscribe((data) => {
      this.entitlements = data;
      const igEnabled = !data || isFeatureEnabled(data.features, 'network.instagram');
      this.placeholderNetworks = this.placeholderNetworks.map((n) =>
        n.id === 'instagram' ? { ...n, available: igEnabled } : n
      );
      this.updatePostPlanGate();
    });
    this.subscriptions.add(sub);
  }

  private computeSelectedDelta(): number {
    if (this.isInstagramMode) {
      return this.instagramAccountIds.length;
    }
    return this.facebookAccountIds.length;
  }

  private updatePostPlanGate(): void {
    if (!this.entitlements) {
      this.canCreatePostPlan = true;
      this.limitGateErrorMessage = null;
      return;
    }
    if (this.loadingPages && !this.isInstagramMode) {
      this.canCreatePostPlan = true;
      this.limitGateErrorMessage = null;
      return;
    }
    if (this.loadingInstagram && this.isInstagramMode) {
      this.canCreatePostPlan = true;
      this.limitGateErrorMessage = null;
      return;
    }

    const schedulerEnabled = isFeatureEnabled(this.entitlements.features, 'module.scheduler');
    if (!schedulerEnabled) {
      this.canCreatePostPlan = false;
      this.limitGateErrorMessage = 'Tu plan no permite programar publicaciones.';
      return;
    }

    if (this.isInstagramMode) {
      if (!isFeatureEnabled(this.entitlements.features, 'network.instagram')) {
        this.canCreatePostPlan = false;
        this.limitGateErrorMessage = 'Tu plan no permite publicar en Instagram.';
        return;
      }
    } else {
      const pagesEnabled = isFeatureEnabled(this.entitlements.features, 'network.facebook.pages');
      if (!pagesEnabled) {
        this.canCreatePostPlan = false;
        this.limitGateErrorMessage = 'Tu plan no permite publicar con Facebook Pages.';
        return;
      }
    }

    const postsThisMonth = this.entitlements.currentUsage.postsThisMonth ?? 0;
    const postsPerMonthLimit = getLimitValue(this.entitlements.limits, ['limit.postsPerMonth']);
    const delta = this.computeSelectedDelta();

    if (delta === 0) {
      this.canCreatePostPlan = true;
      this.limitGateErrorMessage = null;
      return;
    }

    if (!canUseLimit(postsThisMonth, postsPerMonthLimit, delta)) {
      if (postsPerMonthLimit == null) {
        this.canCreatePostPlan = true;
        this.limitGateErrorMessage = null;
        return;
      }
      this.canCreatePostPlan = false;
      this.limitGateErrorMessage = 'Has alcanzado el límite mensual de publicaciones. Actualiza tu plan.';
      return;
    }

    this.canCreatePostPlan = true;
    this.limitGateErrorMessage = null;
  }

  private updateMessageValidators(): void {
    const ctrl = this.postPlanForm.get('message');
    if (!ctrl) return;
    const limit = this.isInstagramMode ? this.charLimitInstagram : this.charLimitFacebook;
    ctrl.setValidators([Validators.required, Validators.minLength(1), Validators.maxLength(limit)]);
    ctrl.updateValueAndValidity();
  }

  setPublishMode(mode: 'now' | 'schedule'): void {
    this.publishMode = mode;
    const schedCtrl = this.postPlanForm.get('scheduledAt');
    if (mode === 'now') {
      schedCtrl?.clearValidators();
    } else {
      schedCtrl?.setValidators([Validators.required]);
    }
    schedCtrl?.updateValueAndValidity();
  }

  selectPreviewNetwork(id: PreviewNetworkId): void {
    const row = this.placeholderNetworks.find((n) => n.id === id);
    if (row && !row.available) return;
    this.previewNetwork = id;
    this.updateMessageValidators();
    this.updatePostPlanGate();
  }

  toggleInstagramAccount(accountId: number): void {
    const idx = this.instagramAccountIds.indexOf(accountId);
    if (idx >= 0) {
      this.instagramAccountIds.splice(idx, 1);
    } else {
      this.instagramAccountIds.push(accountId);
    }
    this.instagramAccountIds = [...this.instagramAccountIds];
    this.updatePostPlanGate();
  }

  isInstagramAccountSelected(accountId: number): boolean {
    return this.instagramAccountIds.includes(accountId);
  }

  isInstagramAccountDisabled(account: SocialAccount): boolean {
    return !isInstagramAccountSelectable(account);
  }

  getInstagramQuotaLabel(account: SocialAccount): string {
    if (!account.publishingQuota) return '';
    return `${account.publishingQuota.remaining} restantes`;
  }

  selectAllInstagramAccounts(): void {
    this.instagramAccountIds = this.instagramAccounts
      .filter((a) => isInstagramAccountSelectable(a))
      .map((a) => a.id);
    this.updatePostPlanGate();
  }

  deselectAllInstagramAccounts(): void {
    this.instagramAccountIds = [];
    this.updatePostPlanGate();
  }

  get selectedInstagramAccounts(): SocialAccount[] {
    return this.instagramAccounts.filter((a) => this.instagramAccountIds.includes(a.id));
  }

  removePlanMediaItem(mediaId: number): void {
    this.planMediaItems = this.planMediaItems.filter((m) => m.composerMediaId !== mediaId);
  }

  get hasVideoInPlanMedia(): boolean {
    return this.planMediaItems.some((m) => m.mimeType.startsWith('video/'));
  }

  toggleFacebookAccount(accountId: number): void {
    const idx = this.facebookAccountIds.indexOf(accountId);
    if (idx >= 0) {
      this.facebookAccountIds.splice(idx, 1);
    } else {
      this.facebookAccountIds.push(accountId);
    }
    this.facebookAccountIds = [...this.facebookAccountIds];
    this.updatePostPlanGate();
  }

  isFacebookAccountSelected(accountId: number): boolean {
    return this.facebookAccountIds.includes(accountId);
  }

  togglePageSelection(pageId: string): void {
    const account = this.facebookAccounts.find((a) => a.externalAccountId === pageId);
    if (account) {
      this.toggleFacebookAccount(account.id);
    }
  }

  isPageSelected(pageId: string): boolean {
    const account = this.facebookAccounts.find((a) => a.externalAccountId === pageId);
    return account ? this.isFacebookAccountSelected(account.id) : false;
  }

  selectAllPages(): void {
    this.facebookAccountIds = this.facebookAccounts.map((a) => a.id);
    this.updatePostPlanGate();
  }

  deselectAllPages(): void {
    this.facebookAccountIds = [];
    this.updatePostPlanGate();
  }

  get selectedPages(): FacebookPage[] {
    return this.facebookAccounts
      .filter((a) => this.facebookAccountIds.includes(a.id))
      .map((a) => this.social.accountToFacebookPage(a));
  }

  get primaryPreviewPage(): FacebookPage | null {
    const sel = this.selectedPages;
    return sel.length ? sel[0] : null;
  }

  get messageLength(): number {
    return (this.postPlanForm.get('message')?.value || '').length;
  }

  /** Límite de caracteres mostrado (por red cuando exista API). */
  get charLimitActive(): number {
    return this.isInstagramMode ? this.charLimitInstagram : this.charLimitFacebook;
  }

  insertIntoMessage(text: string): void {
    const ctrl = this.postPlanForm.get('message');
    if (!ctrl) return;
    const el = this.messageTextarea?.nativeElement;
    const val = (ctrl.value as string) || '';
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      const next = val.slice(0, start) + text + val.slice(end);
      ctrl.setValue(next);
      setTimeout(() => {
        el.focus();
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      ctrl.setValue(val + text);
    }
  }

  insertHashtag(): void {
    this.insertIntoMessage(' #');
  }

  insertMention(): void {
    this.insertIntoMessage(' @');
  }

  toggleEmojiPanel(): void {
    this.showEmojiPanel = !this.showEmojiPanel;
  }

  addEmoji(e: string): void {
    this.insertIntoMessage(e);
    this.showEmojiPanel = false;
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const file = ev.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
      this.openMediaPanel('device', file);
    }
  }

  openMediaPanel(tab: MediaPanelTab = 'device', pendingFile: File | null = null): void {
    this.mediaPanelInitialTab = tab;
    this.mediaPanelPendingFile = pendingFile;
    this.showMediaPanel = true;
  }

  onMediaPanelOpenChange(open: boolean): void {
    this.showMediaPanel = open;
    if (!open) {
      this.mediaPanelPendingFile = null;
    }
  }

  onMediaApplied(payload: MediaAppliedPayload): void {
    if (this.isInstagramMode && payload.selections?.length) {
      if (payload.selections.length === 1 && !this.mediaPanelMultiSelect) {
        this.planMediaItems = payload.selections;
      } else if (this.mediaPanelMultiSelect) {
        const merged = [...this.planMediaItems];
        for (const sel of payload.selections) {
          if (!merged.some((m) => m.composerMediaId === sel.composerMediaId)) {
            merged.push(sel);
          }
        }
        this.planMediaItems = merged.slice(0, 10);
      } else {
        this.planMediaItems = payload.selections;
      }
      const first = this.planMediaItems[0];
      if (first?.publicUrl) {
        this.postPlanForm.patchValue({ imageUrl: first.publicUrl, mediaId: null });
      }
      return;
    }

    if (payload.mediaId != null && payload.mediaId !== undefined) {
      this.planMediaItems = payload.selections?.length
        ? payload.selections
        : [{ composerMediaId: payload.mediaId, mimeType: 'image/jpeg', publicUrl: payload.imageUrl }];
      this.postPlanForm.patchValue({
        mediaId: payload.mediaId,
        imageUrl: payload.imageUrl?.trim() ?? ''
      });
    } else {
      this.postPlanForm.patchValue({
        mediaId: null,
        imageUrl: payload.imageUrl?.trim() ?? ''
      });
      this.planMediaItems = [];
    }
    this.postPlanForm.get('imageUrl')?.markAsTouched();
  }

  get selectedPlanMediaIds(): number[] {
    return this.planMediaItems.map((m) => m.composerMediaId);
  }

  previewImageSrc(): string | null {
    const url = (this.postPlanForm.get('imageUrl')?.value || '').trim();
    return url || null;
  }

  onSubmitPublishMode(mode: 'now' | 'schedule'): void {
    this.setPublishMode(mode);
    this.onSubmit();
  }

  onSubmit(): void {
    const sched = this.postPlanForm.get('scheduledAt');
    if (this.publishMode === 'now') {
      sched?.clearValidators();
    } else {
      sched?.setValidators([Validators.required]);
    }
    sched?.updateValueAndValidity();

    if (this.postPlanForm.invalid) {
      markFormGroupTouched(this.postPlanForm);
      this.errorMessage = '';
      return;
    }

    if (!this.canCreatePostPlan) {
      this.errorMessage = this.limitGateErrorMessage || 'No puedes crear este plan con tu plan actual.';
      return;
    }

    if (this.isInstagramMode) {
      const mediaError = validateInstagramMediaSelection(this.planMediaItems, environment.metaAllowMixedCarousel);
      if (mediaError) {
        this.errorMessage = mediaError;
        return;
      }
      if (this.instagramAccountIds.length === 0) {
        this.errorMessage = 'Selecciona al menos una cuenta de Instagram.';
        return;
      }
      const contentType = inferInstagramContentType(this.planMediaItems, this.publishAsReel);
      for (const id of this.instagramAccountIds) {
        const account = this.instagramAccounts.find((a) => a.id === id);
        if (account && !accountSupportsContentType(account, contentType)) {
          this.errorMessage = `La cuenta "${account.displayName}" no admite este tipo de contenido.`;
          return;
        }
      }
    } else {
      if (this.facebookAccountIds.length === 0) {
        this.errorMessage = 'Selecciona al menos una página de Facebook.';
        return;
      }
    }

    this.isLoading = true;
    this.errorMessage = '';

    const formValue = this.postPlanForm.value;
    let scheduledAtISO: string;
    if (this.publishMode === 'now') {
      scheduledAtISO = new Date().toISOString();
    } else {
      scheduledAtISO = new Date(formValue.scheduledAt).toISOString();
    }

    const request: CreatePostPlanRequest = {
      scheduledAt: scheduledAtISO,
      timezone: formValue.timezone,
      message: formValue.message.trim()
    };

    if (this.isInstagramMode) {
      request.destinations = this.instagramAccountIds.map((id) => ({ managedSocialAccountId: id }));
      request.planMedia = buildPlanMedia(this.planMediaItems);
      request.providerOptions = {
        instagram: buildInstagramProviderOptions(this.planMediaItems, this.publishAsReel)
      };
    } else {
      request.destinations = this.facebookAccountIds.map((id) => ({ managedSocialAccountId: id }));
      if (formValue.linkUrl?.trim()) {
        request.linkUrl = formValue.linkUrl.trim();
      }
      if (formValue.imageUrl?.trim()) {
        request.imageUrl = formValue.imageUrl.trim();
      }
      if (this.planMediaItems.length) {
        request.planMedia = buildPlanMedia(this.planMediaItems);
      } else if (formValue.mediaId != null && typeof formValue.mediaId === 'number') {
        request.planMedia = buildPlanMedia([
          { composerMediaId: formValue.mediaId, mimeType: 'image/jpeg' }
        ]);
      }
    }

    if (formValue.dedupeKey?.trim()) {
      request.dedupeKey = formValue.dedupeKey.trim();
    }

    const createSubscription = this.postPlanService.createPostPlan(request).subscribe({
      next: () => {
        this.isLoading = false;
        this.clearDraftStorage();
        this.planMediaItems = [];
        this.instagramAccountIds = [];
        this.facebookAccountIds = [];
        this.success.emit();
        this.tenantEntitlements.refreshCurrentEntitlements().subscribe(() => this.updatePostPlanGate());
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = extractMetaError(
          error,
          'Error al crear el plan de publicación. Por favor, intenta nuevamente.'
        ).message;
      }
    });

    this.subscriptions.add(createSubscription);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  getFieldError(fieldName: string): string {
    return getFieldError(this.postPlanForm, fieldName);
  }

  isFieldInvalid(fieldName: string): boolean {
    return isFieldInvalid(this.postPlanForm, fieldName);
  }

  accountsSelectionError(): boolean {
    if (this.isInstagramMode) {
      return this.instagramAccountIds.length === 0;
    }
    return this.facebookAccountIds.length === 0;
  }

  pagesSelectionError(): boolean {
    return this.accountsSelectionError();
  }

  ctaDisabled(): boolean {
    return this.isLoading || this.postPlanForm.invalid || !this.canCreatePostPlan;
  }
}
