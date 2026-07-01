import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PostPlanService } from '../../services/post-plan.service';
import { CreatePostPlanRequest } from '../../models/post-plan.model';
import { FacebookOAuthService } from '../../../../core/services/facebook-oauth.service';
import { SocialService } from '../../../../core/services/social.service';
import { SocialAccount } from '../../../social/models/social.model';
import { TenantEntitlementsResponse } from '../../../../core/models/tenant.model';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import { canUseLimit, getLimitValue, isFeatureEnabled } from '../../../../core/utils/entitlements.utils';
import { FacebookPage } from '../../../facebook/models/facebook.model';
import { markFormGroupTouched, isFieldInvalid } from '../../../../shared/utils/form.utils';
import { extractErrorMessage } from '../../../../shared/utils/error.utils';
import { getFieldError } from '../../../../shared/utils/validation.utils';

@Component({
  selector: 'app-create-post-plan-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-post-plan-form.component.html',
  styleUrl: './create-post-plan-form.component.scss'
})
export class CreatePostPlanFormComponent implements OnInit, OnDestroy {
  @Input() initialDate?: string; // Fecha inicial desde el calendario (ISO string)
  @Output() success = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  postPlanForm!: FormGroup;
  pages: FacebookPage[] = [];
  facebookAccounts: SocialAccount[] = [];
  loadingPages = true;
  isLoading = false;
  errorMessage = '';
  entitlements: TenantEntitlementsResponse['data'] | null = null;
  entitlementsLoading = false;
  canCreatePostPlan = true;
  limitGateErrorMessage: string | null = null;
  private subscriptions = new Subscription();

  // Timezones comunes
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
    private facebookService: FacebookOAuthService,
    private social: SocialService,
    private tenantEntitlements: TenantEntitlementsService
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadPages();
    this.refreshEntitlements();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  initForm(): void {
    // Preparar fecha inicial
    let initialDateTime = '';
    if (this.initialDate) {
      const date = new Date(this.initialDate);
      // Formato para input datetime-local: YYYY-MM-DDTHH:mm
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      initialDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      // Si no hay fecha inicial, usar ahora + 1 hora
      const now = new Date();
      now.setHours(now.getHours() + 1);
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      initialDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    this.postPlanForm = this.fb.group({
      scheduledAt: [initialDateTime, [Validators.required]],
      timezone: ['America/Bogota', [Validators.required]],
      message: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(5000)]],
      linkUrl: [''],
      imageUrl: [''],
      pageIds: [[]],
      dedupeKey: ['']
    });
  }

  loadPages(): void {
    this.loadingPages = true;
    const pagesSubscription = this.social
      .getAccounts({ providerGroup: 'meta', provider: 'facebook', accountType: 'page', forPublishing: true })
      .subscribe({
        next: (accounts) => {
          this.facebookAccounts = accounts.filter((a) => a.isActive && a.canPublish);
          this.pages = this.facebookAccounts.map((a) => this.social.accountToFacebookPage(a));
          this.loadingPages = false;
          this.updatePostPlanGate();
        },
      error: (error) => {
        console.error('Error al cargar páginas:', error);
        this.loadingPages = false;
        this.errorMessage = 'Error al cargar las páginas de Facebook. Por favor, intenta nuevamente.';
      }
    });
    this.subscriptions.add(pagesSubscription);
  }

  private refreshEntitlements(): void {
    this.entitlementsLoading = true;
    const sub = this.tenantEntitlements.refreshCurrentEntitlements().subscribe((data) => {
      this.entitlements = data;
      this.entitlementsLoading = false;
      this.updatePostPlanGate();
    });
    this.subscriptions.add(sub);
  }

  private computeSelectedDelta(): number {
    const pageIds: string[] = this.postPlanForm.get('pageIds')?.value || [];
    if (pageIds.length > 0) return pageIds.length;
    // Si no hay selección explícita, el backend probablemente publicará en todas las páginas disponibles del UI.
    return this.pages.length;
  }

  private updatePostPlanGate(): void {
    // Si aún no tenemos info de entitlements o páginas, no bloquear hasta que haya datos.
    if (!this.entitlements) {
      this.canCreatePostPlan = true;
      this.limitGateErrorMessage = null;
      return;
    }
    if (this.loadingPages) {
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

    const pagesEnabled = isFeatureEnabled(this.entitlements.features, 'network.facebook.pages');
    if (!pagesEnabled) {
      this.canCreatePostPlan = false;
      this.limitGateErrorMessage = 'Tu plan no permite publicar con Facebook Pages.';
      return;
    }

    const postsThisMonth = this.entitlements.currentUsage.postsThisMonth ?? 0;
    const postsPerMonthLimit = getLimitValue(this.entitlements.limits, ['limit.postsPerMonth']);
    const delta = this.computeSelectedDelta();

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

  togglePageSelection(pageId: string): void {
    const pageIdsControl = this.postPlanForm.get('pageIds');
    if (!pageIdsControl) return;

    const currentIds: string[] = pageIdsControl.value || [];
    const index = currentIds.indexOf(pageId);

    if (index > -1) {
      currentIds.splice(index, 1);
    } else {
      currentIds.push(pageId);
    }

    pageIdsControl.setValue(currentIds);
    this.updatePostPlanGate();
  }

  isPageSelected(pageId: string): boolean {
    const pageIds: string[] = this.postPlanForm.get('pageIds')?.value || [];
    return pageIds.includes(pageId);
  }

  selectAllPages(): void {
    const allPageIds = this.pages.map(page => page.facebookPageId);
    this.postPlanForm.get('pageIds')?.setValue(allPageIds);
    this.updatePostPlanGate();
  }

  deselectAllPages(): void {
    this.postPlanForm.get('pageIds')?.setValue([]);
    this.updatePostPlanGate();
  }

  onSubmit(): void {
    if (this.postPlanForm.invalid) {
      markFormGroupTouched(this.postPlanForm);
      return;
    }

    if (!this.canCreatePostPlan) {
      this.errorMessage = this.limitGateErrorMessage || 'No puedes crear este plan con tu plan actual.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const formValue = this.postPlanForm.value;
    
    // Convertir datetime-local a ISO string
    const scheduledAtDate = new Date(formValue.scheduledAt);
    const scheduledAtISO = scheduledAtDate.toISOString();

    // Preparar request
    const request: CreatePostPlanRequest = {
      scheduledAt: scheduledAtISO,
      timezone: formValue.timezone,
      message: formValue.message.trim()
    };

    if (formValue.linkUrl?.trim()) {
      request.linkUrl = formValue.linkUrl.trim();
    }
    if (formValue.imageUrl?.trim()) {
      request.imageUrl = formValue.imageUrl.trim();
    }
    if (formValue.dedupeKey?.trim()) {
      request.dedupeKey = formValue.dedupeKey.trim();
    }

    const selectedExternalIds: string[] =
      formValue.pageIds?.length > 0
        ? formValue.pageIds
        : this.facebookAccounts.map((a) => a.externalAccountId);
    request.destinations = this.facebookAccounts
      .filter((a) => selectedExternalIds.includes(a.externalAccountId))
      .map((a) => ({ managedSocialAccountId: a.id }));

    const createSubscription = this.postPlanService.createPostPlan(request).subscribe({
      next: (response) => {
        this.isLoading = false;
        // Mostrar mensaje de éxito
        alert(`Plan creado exitosamente!\n${response.data.message}\nTargets creados: ${response.data.targetsCreated}\nTargets omitidos: ${response.data.targetsSkipped}`);
        this.success.emit();

        // Refrescar entitlements/uso para que el UI refleje el enforcement real del backend.
        this.tenantEntitlements.refreshCurrentEntitlements().subscribe(() => {
          this.updatePostPlanGate();
        });
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = extractErrorMessage(
          error,
          'Error al crear el plan de publicación. Por favor, intenta nuevamente.'
        );
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
}
