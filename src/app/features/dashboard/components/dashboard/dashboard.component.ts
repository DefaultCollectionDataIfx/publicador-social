import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, RouterOutlet, NavigationEnd } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { filter, switchMap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../../core/services/auth.service';
import { UserData, UserProfileData } from '../../../../core/models/auth.model';
import { TenantService } from '../../../../core/services/tenant.service';
import { SelectedTenant, TenantSummary, TenantEntitlementsResponse } from '../../../../core/models/tenant.model';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import { isAnyMenuFeatureStrict } from '../../../../core/utils/entitlements.utils';
import { FacebookConnectComponent } from '../../../../shared/components/facebook-connect/facebook-connect.component';
import { validateAvatarUrl } from '../../../../shared/utils/validation.utils';
import { extractErrorMessage } from '../../../../shared/utils/error.utils';

interface MenuItem {
  label: string;
  route?: string; // Opcional si tiene submenú
  icon?: string; // SVG como string opcional
  hasSubmenu?: boolean; // Flag para identificar si tiene submenú
  children?: MenuItem[]; // Submenú
  /** Si se define, el ítem es visible si alguna clave está habilitada en el plan. */
  featureKeys?: string[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, RouterOutlet, FacebookConnectComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  user: UserData | UserProfileData | null = null;
  tenants: TenantSummary[] = [];
  currentTenant: SelectedTenant | null = null;
  loadingTenants = false;
  tenantsError: string | null = null;
  /** Varios tenants y ninguno válido en contexto: bloquear hasta elegir (modal). */
  showTenantPickerModal = false;
  /** Alta de organización propia (POST /api/tenants/personal). */
  personalTenantName = '';
  creatingPersonalTenant = false;
  personalTenantError: string | null = null;
  /** Valor del select del modal antes de confirmar. */
  modalTenantSelectionId: number | null = null;
  sidebarCollapsed = false;
  showUserDropdown = false;
  showNotifications = false;
  activeSection = 'Dashboard';
  expandedMenuItems: Set<string> = new Set(); // Para trackear qué items están expandidos
  avatarUrlWithCache: string | null = null;
  private subscriptions = new Subscription();
  private readonly iconHtmlCache = new Map<string, SafeHtml>();

  /** Entitlements del tenant actual (menú y redirecciones). */
  entitlements: TenantEntitlementsResponse['data'] | null = null;

  /** Menú filtrado por plan; se recalcula solo cuando cambian los entitlements. */
  visibleMenuItems: MenuItem[] = [];

  /** Definición completa del menú. */
  private readonly allMenuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      route: '/dashboard',
      featureKeys: ['module.dashboard'],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m4 12 8-8 8 8M6 10.5V19a1 1 0 0 0 1 1h3v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3h3a1 1 0 0 0 1-1v-8.5"/>
      </svg>`
    },
    {
      label: 'Programador',
      route: '/dashboard/programador',
      featureKeys: ['module.scheduler'],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
      </svg>`
    },
    {
      label: 'Analíticas',
      route: '/dashboard/analiticas',
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18.5A2.493 2.493 0 0 1 7.51 20H7.5a2.468 2.468 0 0 1-2.4-3.154 2.98 2.98 0 0 1-.85-5.274 2.468 2.468 0 0 1 .92-3.182 2.477 2.477 0 0 1 1.876-3.344 2.5 2.5 0 0 1 3.41-1.856A2.5 2.5 0 0 1 12 5.5m0 13v-13m0 13a2.493 2.493 0 0 0 4.49 1.5h.01a2.468 2.468 0 0 0 2.403-3.154 2.98 2.98 0 0 0 .847-5.274 2.468 2.468 0 0 0-.921-3.182 2.477 2.477 0 0 0-1.875-3.344A2.5 2.5 0 0 0 14.5 3 2.5 2.5 0 0 0 12 5.5m-8 5a2.5 2.5 0 0 1 3.48-2.3m-.28 8.551a3 3 0 0 1-2.953-5.185M20 10.5a2.5 2.5 0 0 0-3.481-2.3m.28 8.551a3 3 0 0 0 2.954-5.185"/>
      </svg>`,
      hasSubmenu: true,
      children: [
        {
          label: 'Páginas',
          route: '/dashboard/analiticas',
          featureKeys: ['network.facebook.pages'],
          icon: `<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
          </svg>`
        },
        {
          label: 'Grupos',
          route: '/dashboard/analiticas',
          featureKeys: ['network.facebook.groups'],
          icon: `<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>`
        }
      ]
    },
    {
      label: 'Mensajes',
      route: '/dashboard/mensajes',
      featureKeys: ['module.inbox'],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
      </svg>`
    },
    {
      label: 'Cuentas conectadas',
      route: '/dashboard/cuentas-conectadas',
      featureKeys: ['network.facebook.pages', 'network.facebook.groups', 'network.instagram', 'network.linkedin', 'network.threads'],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12h4m-2 2v-4M4 18v-1a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Zm8-10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
      </svg>`
    },
    {
      label: 'Colecciones',
      route: '/dashboard/colecciones',
      featureKeys: ['module.collections'],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/>
      </svg>`
    },
    {
      label: 'Gestor de archivos',
      route: '/dashboard/archivos',
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 0 1 2-2h4.586a1 1 0 0 1 .707.293L12 7h7a2 2 0 0 1 2 2v1H3V7Z"/>
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18l-1.1 8.2A2 2 0 0 1 17.92 20H6.08a2 2 0 0 1-1.98-1.8L3 10Z"/>
      </svg>`
    },
    {
      label: 'Automatizaciones',
      route: '/dashboard/automatizaciones',
      featureKeys: ['module.automations'],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 6c0 1.657-3.134 3-7 3S5 7.657 5 6m14 0c0-1.657-3.134-3-7-3S5 4.343 5 6m14 0v6M5 6v6m0 0c0 1.657 3.134 3 7 3s7-1.343 7-3M5 12v6c0 1.657 3.134 3 7 3s7-1.343 7-3v-6"/>
      </svg>`
    },
    {
      label: 'Integraciones',
      route: '/dashboard/integraciones',
      featureKeys: [
        'network.facebook.pages',
        'network.facebook.groups',
        'network.linkedin',
        'network.tiktok',
        'network.twitter',
        'network.instagram',
        'network.threads'
      ],
      icon: `<svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5v14m8-7h-2m0 0h-2m2 0v2m0-2v-2M3 11h6m-6 4h6m11 4H4c-.55228 0-1-.4477-1-1V6c0-.55228.44772-1 1-1h16c.5523 0 1 .44772 1 1v12c0 .5523-.4477 1-1 1Z"/>
      </svg>`
    }
  ];

  readonly configIcon: SafeHtml;
  readonly notificationIcon: SafeHtml;

  constructor(
    private authService: AuthService,
    private router: Router,
    private sanitizer: DomSanitizer,
    private tenantService: TenantService,
    private tenantContext: TenantContextService,
    private tenantEntitlements: TenantEntitlementsService
  ) {
    this.cacheMenuIcons();
    this.configIcon = this.sanitizer.bypassSecurityTrustHtml(`
      <svg class="menu-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13v-2a1 1 0 0 0-1-1h-.757l-.707-1.707.535-.536a1 1 0 0 0 0-1.414l-1.414-1.414a1 1 0 0 0-1.414 0l-.536.535L14 4.757V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v.757l-1.707.707-.536-.535a1 1 0 0 0-1.414 0L4.929 6.343a1 1 0 0 0 0 1.414l.536.536L4.757 10H4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h.757l.707 1.707-.535.536a1 1 0 0 0 0 1.414l1.414 1.414a1 1 0 0 0 1.414 0l.536-.535 1.707.707V20a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-.757l1.707-.708.536.536a1 1 0 0 0 1.414 0l1.414-1.414a1 1 0 0 0 0-1.414l-.535-.536.707-1.707H20a1 1 0 0 0 1-1Z"/>
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
      </svg>
    `);
    this.notificationIcon = this.sanitizer.bypassSecurityTrustHtml(`
      <svg class="notification-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5.464V3.099m0 2.365a5.338 5.338 0 0 1 5.133 5.368v1.8c0 2.386 1.867 2.982 1.867 4.175C19 17.4 19 18 18.462 18H5.538C5 18 5 17.4 5 16.807c0-1.193 1.867-1.789 1.867-4.175v-1.8A5.338 5.338 0 0 1 12 5.464ZM6 5 5 4M4 9H3m15-4 1-1m1 5h1M8.54 18a3.48 3.48 0 0 0 6.92 0H8.54Z"/>
      </svg>
    `);
    this.rebuildVisibleMenuItems();
  }

  /** Menú filtrado por `features` del plan actual. */
  /** Sin workspaces tras GET exitoso: pantalla para crear organización propia. */
  get showNoOrganizationsPanel(): boolean {
    return (
      !this.loadingTenants &&
      !this.tenantsError &&
      this.tenants.length === 0 &&
      !this.showTenantPickerModal
    );
  }

  /** Rutas hijas solo con al menos un tenant y sin error de carga inicial. */
  get canShowDashboardRoutes(): boolean {
    return (
      !this.loadingTenants &&
      !this.showTenantPickerModal &&
      !this.tenantsError &&
      this.tenants.length > 0
    );
  }

  private rebuildVisibleMenuItems(): void {
    const features = this.entitlements?.features;
    this.visibleMenuItems = this.allMenuItems
      .map((item) => this.projectVisibleMenuItem(item, features))
      .filter((item): item is MenuItem => item !== null);
  }

  private cacheMenuIcons(): void {
    for (const item of this.allMenuItems) {
      if (item.icon) {
        this.iconHtmlCache.set(item.icon, this.sanitizer.bypassSecurityTrustHtml(item.icon));
      }
      item.children?.forEach((child) => {
        if (child.icon) {
          this.iconHtmlCache.set(child.icon, this.sanitizer.bypassSecurityTrustHtml(child.icon));
        }
      });
    }
  }

  trackByMenuLabel(_index: number, item: MenuItem): string {
    return item.label;
  }

  trackByChildLabel(_index: number, child: MenuItem): string {
    return child.label;
  }

  private projectVisibleMenuItem(
    item: MenuItem,
    features: Record<string, boolean> | undefined
  ): MenuItem | null {
    if (item.hasSubmenu && item.children?.length) {
      const children = item.children
        .map((c) => (this.isMenuEntryVisible(c, features) ? c : null))
        .filter((c): c is MenuItem => c !== null);
      if (children.length === 0) return null;
      if (item.featureKeys?.length && !isAnyMenuFeatureStrict(features, item.featureKeys)) {
        return null;
      }
      return { ...item, children };
    }
    if (!this.isMenuEntryVisible(item, features)) return null;
    return item;
  }

  private isMenuEntryVisible(
    item: MenuItem,
    features: Record<string, boolean> | undefined
  ): boolean {
    if (!item.featureKeys?.length) return true;
    return isAnyMenuFeatureStrict(features, item.featureKeys);
  }

  /**
   * Si el usuario cae en una ruta cuyo módulo no está en el plan, vuelve al inicio del dashboard.
   */
  private maybeRedirectIfRouteBlocked(): void {
    const features = this.entitlements?.features;
    if (!features) return;

    const path = this.router.url.split('?')[0];
    const gates: { prefix: string; keys: string[] }[] = [
      { prefix: '/dashboard/programador', keys: ['module.scheduler'] },
      { prefix: '/dashboard/colecciones', keys: ['module.collections'] },
      { prefix: '/dashboard/cuentas-conectadas', keys: ['network.facebook.pages', 'network.facebook.groups', 'network.instagram', 'network.linkedin', 'network.threads'] },
      { prefix: '/dashboard/cuentas', keys: ['network.facebook.pages', 'network.facebook.groups'] },
      { prefix: '/dashboard/mensajes', keys: ['module.inbox'] },
      { prefix: '/dashboard/analiticas', keys: ['network.facebook.pages', 'network.facebook.groups'] },
      { prefix: '/dashboard/paginas', keys: ['network.facebook.pages'] },
      { prefix: '/dashboard/grupos', keys: ['network.facebook.groups'] },
      { prefix: '/dashboard/automatizaciones', keys: ['module.automations'] },
      {
        prefix: '/dashboard/integraciones',
        keys: [
          'network.facebook.pages',
          'network.facebook.groups',
          'network.linkedin',
          'network.tiktok',
          'network.twitter',
          'network.instagram',
          'network.threads'
        ]
      }
    ];

    for (const g of gates) {
      if (path === g.prefix || path.startsWith(g.prefix + '/')) {
        if (!isAnyMenuFeatureStrict(features, g.keys)) {
          this.router.navigate(['/dashboard']);
        }
        return;
      }
    }
  }

  ngOnInit() {
    // Verificar autenticación
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    this.user = this.authService.getUser();

    if (!this.user) {
      // Si no hay datos de usuario pero hay token, limpiar y redirigir
      this.authService.logout();
      this.router.navigate(['/login']);
      return;
    }

    // Inicializar avatar URL
    this.updateAvatarUrl();

    const entitlementsSubscription = this.tenantEntitlements.entitlements$.subscribe((e) => {
      this.entitlements = e;
      this.rebuildVisibleMenuItems();
      this.maybeRedirectIfRouteBlocked();
    });
    this.subscriptions.add(entitlementsSubscription);

    const tenantSubscription = this.tenantContext.currentTenant$
      .pipe(
        switchMap((tenant) => {
          this.currentTenant = tenant;
          if (!tenant) {
            return of(null);
          }
          return this.tenantEntitlements.refreshCurrentEntitlements();
        })
      )
      .subscribe();
    this.subscriptions.add(tenantSubscription);

    // Cargar tenants del usuario
    this.loadTenants();

    // Si el usuario no tiene avatarUrl, obtener perfil completo del servidor
    const userProfile = this.user as UserProfileData;
    if (!userProfile.avatarUrl) {
      const profileSubscription = this.authService.getProfile().subscribe({
        next: (response) => {
          const profileData = response.data;
          // Actualizar datos del usuario con el perfil completo
          this.authService.updateUserData(profileData);
          this.user = profileData;
          this.updateAvatarUrl(true); // Forzar actualización del avatar
        },
        error: (error: HttpErrorResponse) => {
          console.error('Error al obtener perfil completo:', error);
          // Continuar con los datos básicos si falla
        }
      });
      this.subscriptions.add(profileSubscription);
    }

    // Detectar sección activa desde la ruta
    this.updateActiveSection();
    const navigationSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.updateActiveSection();
        // Auto-expandir submenú de Analíticas si estamos en esa ruta
        const analyticsItem = this.allMenuItems.find(item => item.label === 'Analíticas');
        if (analyticsItem && this.router.url.startsWith('/dashboard/analiticas')) {
          if (!this.expandedMenuItems.has('Analíticas')) {
            this.expandedMenuItems.add('Analíticas');
          }
        }

        // Recargar datos del usuario cuando se vuelve al dashboard (por si cambió el perfil)
        if (this.router.url === '/dashboard' || this.router.url.startsWith('/dashboard/')) {
          this.refreshUserData();
        }
      });

    this.subscriptions.add(navigationSubscription);

    // Auto-expandir submenú de Analíticas si estamos en esa ruta al iniciar
    if (this.router.url.startsWith('/dashboard/analiticas')) {
      const analyticsItem = this.allMenuItems.find(item => item.label === 'Analíticas');
      if (analyticsItem) {
        this.expandedMenuItems.add('Analíticas');
      }
    }

    // Cerrar dropdowns al hacer click fuera (mejora UX)
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    document.addEventListener('click', this.handleDocumentClick);

    // Escuchar cambios en el storage para actualizar avatar cuando se cambia desde otra página/pestaña
    const storageListener = (e: StorageEvent) => {
      if (e.key === 'user_data' && e.newValue) {
        setTimeout(() => {
          this.refreshUserData();
        }, 100);
      }
    };
    window.addEventListener('storage', storageListener);

    // Verificar periódicamente si el usuario cambió (para cambios en la misma ventana)
    // Esto es necesario porque el evento storage solo se dispara en otras ventanas
    const checkUserInterval = setInterval(() => {
      const currentUser = this.authService.getUser();
      if (currentUser && this.user) {
        const currentAvatarUrl = validateAvatarUrl((currentUser as UserProfileData).avatarUrl);
        const cachedAvatarUrl = validateAvatarUrl((this.user as UserProfileData).avatarUrl);

        // Si el avatar cambió, refrescar
        if (currentAvatarUrl !== cachedAvatarUrl) {
          this.refreshUserData();
        }
      } else if (currentUser && !this.user) {
        // Si no había usuario antes pero ahora sí, actualizar
        this.refreshUserData();
      }
    }, 500); // Verificar cada 500ms para respuesta más rápida

    // Limpiar listeners al destruir el componente
    this.subscriptions.add({
      unsubscribe: () => {
        clearInterval(checkUserInterval);
        window.removeEventListener('storage', storageListener);
      }
    });
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    document.removeEventListener('click', this.handleDocumentClick);
  }

  /**
   * Carga la lista de tenants del usuario autenticado.
   */
  private loadTenants(): void {
    this.loadingTenants = true;
    this.tenantsError = null;

    const sub = this.tenantService.getUserTenants().subscribe({
      next: (response) => {
        const tenants = this.tenantService.getTenantsListFromResponse(response);
        this.tenants = tenants;
        this.loadingTenants = false;

        const { needsWorkspaceChoice } = this.tenantService.reconcileContextForDashboardLoad(tenants);
        this.showTenantPickerModal = needsWorkspaceChoice;
        if (needsWorkspaceChoice && tenants.length > 0) {
          this.modalTenantSelectionId = tenants[0].tenantId;
        }
      },
      error: (error) => {
        console.error('Error al cargar tenants del usuario:', error);
        this.tenantsError = 'No se pudieron cargar tus workspaces. Intenta nuevamente más tarde.';
        this.loadingTenants = false;
      }
    });

    this.subscriptions.add(sub);
  }

  retryLoadTenants(): void {
    this.tenantsError = null;
    this.loadTenants();
  }

  /**
   * Crea la organización del usuario (Customer sin membresías activas).
   */
  createPersonalOrganization(): void {
    if (this.creatingPersonalTenant) {
      return;
    }
    this.personalTenantError = null;

    const trimmed = this.personalTenantName.trim();
    if (trimmed.length > 200) {
      this.personalTenantError = 'El nombre no puede superar 200 caracteres.';
      return;
    }

    const body = trimmed.length > 0 ? { tenantName: trimmed } : {};

    this.creatingPersonalTenant = true;
    const sub = this.tenantService.createPersonalTenant(body).subscribe({
      next: (response) => {
        const d = this.tenantService.normalizePersonalTenantCreatedData(response.data);
        if (!d.token || !d.idUsuario) {
          this.creatingPersonalTenant = false;
          this.personalTenantError = 'Respuesta del servidor incompleta. Intenta de nuevo.';
          return;
        }
        this.authService.setAuthData(d.token, {
          token: d.token,
          idUsuario: d.idUsuario,
          email: d.email,
          rol: d.rol,
          fullName: d.fullName
        });
        this.refreshUserData();

        const profileSub = this.authService.getProfile().subscribe({
          next: (profileResponse) => {
            this.authService.updateUserData(profileResponse.data);
            this.refreshUserData(true);
          },
          error: () => {
            /* continuar con datos básicos del alta */
          }
        });
        this.subscriptions.add(profileSub);

        this.creatingPersonalTenant = false;
        this.loadTenants();
      },
      error: (error: HttpErrorResponse) => {
        this.creatingPersonalTenant = false;
        this.personalTenantError = extractErrorMessage(
          error,
          'No se pudo crear la organización. Intenta de nuevo.'
        );
      }
    });
    this.subscriptions.add(sub);
  }

  /**
   * Maneja el cambio de tenant desde el selector del header.
   */
  onHeaderTenantChange(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    this.onTenantChange(v);
  }

  onTenantChange(tenantIdValue: string): void {
    const tenantId = Number(tenantIdValue);
    if (!tenantId || isNaN(tenantId)) {
      return;
    }

    const selected = this.tenants.find(t => t.tenantId === tenantId);
    if (!selected) {
      return;
    }

    this.tenantService.setCurrentTenantFromSummary(selected);
  }

  onModalTenantSelect(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    const id = Number(v);
    this.modalTenantSelectionId = !isNaN(id) ? id : null;
  }

  confirmWorkspaceFromModal(): void {
    if (this.modalTenantSelectionId == null) {
      return;
    }
    const selected = this.tenants.find(t => t.tenantId === this.modalTenantSelectionId);
    if (!selected) {
      return;
    }
    this.tenantService.setCurrentTenantFromSummary(selected);
    this.showTenantPickerModal = false;
  }

  private handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;

    // Cerrar dropdown de usuario si se hace click fuera
    if (!target.closest('.user-menu')) {
      this.showUserDropdown = false;
    }

    // Cerrar dropdown de notificaciones si se hace click fuera
    if (!target.closest('.notifications-btn') && !target.closest('.notifications-dropdown')) {
      this.showNotifications = false;
    }
  }

  updateActiveSection() {
    const currentRoute = this.router.url;
    const urlTree = this.router.parseUrl(currentRoute);
    const queryParams = urlTree.queryParams;

    // Manejar ruta de Configuración (está en el footer, no en menuItems)
    if (currentRoute === '/dashboard/configuracion' || currentRoute.startsWith('/dashboard/configuracion')) {
      this.activeSection = 'Configuración';
      return;
    }

    // Buscar en items principales y submenús
    for (const item of this.allMenuItems) {
      if (item.hasSubmenu && item.children) {
        // Verificar si alguna subopción está activa (por ruta o query params)
        const activeChild = item.children.find(child => {
          const baseMatch = currentRoute === child.route || currentRoute.startsWith(child.route + '/');
          // También verificar por query params
          const categoryMatch = child.label === 'Páginas' && queryParams['category'] === 'pages' ||
                               child.label === 'Grupos' && queryParams['category'] === 'groups';
          return baseMatch && (categoryMatch || !queryParams['category']);
        });

        if (activeChild || (currentRoute.startsWith('/dashboard/analiticas') && queryParams['category'])) {
          this.activeSection = activeChild ? `${item.label} - ${activeChild.label}` : item.label;
          // Auto-expandir el submenú si está activo
          if (!this.expandedMenuItems.has(item.label)) {
            this.expandedMenuItems.add(item.label);
          }
          return;
        }
      } else if (item.route && this.menuRouteMatches(currentRoute, item.route)) {
        this.activeSection = item.label;
        return;
      }
    }

    this.activeSection = 'Dashboard';
  }

  /** Fragmento de ruta sin query ni hash (para comparar con rutas del menú). */
  private urlPathWithoutQueryOrHash(fullUrl: string): string {
    const q = fullUrl.indexOf('?');
    const h = fullUrl.indexOf('#');
    let end = fullUrl.length;
    if (q >= 0) {
      end = Math.min(end, q);
    }
    if (h >= 0) {
      end = Math.min(end, h);
    }
    return fullUrl.slice(0, end);
  }

  /**
   * `/dashboard` solo debe coincidir con la home, no con `/dashboard/archivos` ni otras hijas.
   */
  private menuRouteMatches(fullUrl: string, itemRoute: string): boolean {
    const path = this.urlPathWithoutQueryOrHash(fullUrl);
    if (itemRoute === '/dashboard') {
      return path === '/dashboard' || path === '/dashboard/';
    }
    return path === itemRoute || path.startsWith(`${itemRoute}/`);
  }

  /**
   * Toggle del submenú expandible
   */
  toggleSubmenu(itemLabel: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.expandedMenuItems.has(itemLabel)) {
      this.expandedMenuItems.delete(itemLabel);
    } else {
      this.expandedMenuItems.add(itemLabel);
    }
  }

  /**
   * Verifica si un item del menú está expandido
   */
  isSubmenuExpanded(itemLabel: string): boolean {
    return this.expandedMenuItems.has(itemLabel);
  }

  /**
   * Verifica si un submenú está activo basado en la ruta y query params
   */
  isSubmenuActive(childRoute: string, expectedCategory: string): boolean {
    const currentRoute = this.router.url;
    const urlTree = this.router.parseUrl(currentRoute);
    const queryParams = urlTree.queryParams;

    const routeMatch = currentRoute === childRoute || currentRoute.startsWith(childRoute + '/');
    const categoryMatch = queryParams['category'] === expectedCategory;

    return routeMatch && categoryMatch;
  }

  get currentRoute(): string {
    return this.router.url;
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  toggleUserDropdown() {
    this.showUserDropdown = !this.showUserDropdown;
  }

  toggleNotifications() {
    this.showNotifications = !this.showNotifications;
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  navigateTo(route: string) {
    this.router.navigate([route]);
    this.showUserDropdown = false;
  }

  getUserInitials(): string {
    if (!this.user?.fullName) return 'U';
    const names = this.user.fullName.split(' ');
    if (names.length >= 2) {
      return (names[0][0] + names[1][0]).toUpperCase();
    }
    return names[0][0].toUpperCase();
  }

  getUserAvatarUrl(): string | null {
    return this.avatarUrlWithCache;
  }

  /**
   * Actualiza la URL del avatar con cache buster
   * Se llama cuando la URL cambia o cuando se necesita refrescar
   */
  private updateAvatarUrl(forceRefresh: boolean = false): void {
    if (!this.user) {
      this.avatarUrlWithCache = null;
      return;
    }

    const userProfile = this.user as UserProfileData;
    const avatarUrl = validateAvatarUrl(userProfile.avatarUrl);

    if (avatarUrl) {
      // Extraer URL base sin parámetros de query
      const baseUrl = avatarUrl.split('?')[0];
      const cachedBaseUrl = this.avatarUrlWithCache?.split('?')[0];

      // Si se fuerza refresh, la URL base cambió, o no hay cache, generar nuevo timestamp
      if (forceRefresh || baseUrl !== cachedBaseUrl || !this.avatarUrlWithCache) {
        const separator = avatarUrl.includes('?') ? '&' : '?';
        this.avatarUrlWithCache = `${avatarUrl}${separator}t=${Date.now()}`;
      }
      // Si ya hay cache y la URL base es la misma, mantenerlo (evita ExpressionChangedAfterItHasBeenCheckedError)
    } else {
      this.avatarUrlWithCache = null;
    }
  }

  /**
   * Recarga los datos del usuario desde localStorage o servidor.
   * @param forceAvatarRefresh Forzar nuevo cache buster aunque la URL base no haya cambiado
   */
  refreshUserData(forceAvatarRefresh = false): void {
    const currentUser = this.authService.getUser();
    if (!currentUser) {
      return;
    }

    const oldAvatarUrl = this.user ? validateAvatarUrl((this.user as UserProfileData).avatarUrl) : null;
    const newAvatarUrl = validateAvatarUrl((currentUser as UserProfileData).avatarUrl);
    const userChanged = JSON.stringify(this.user) !== JSON.stringify(currentUser);

    if (!userChanged && !forceAvatarRefresh) {
      return;
    }

    this.user = currentUser;

    if (!newAvatarUrl) {
      this.avatarUrlWithCache = null;
    } else if (forceAvatarRefresh || oldAvatarUrl !== newAvatarUrl) {
      this.updateAvatarUrl(true);
    } else if (!this.avatarUrlWithCache) {
      this.updateAvatarUrl();
    }
  }

  getIconHtml(icon: string | undefined): SafeHtml | null {
    if (!icon) return null;
    return this.iconHtmlCache.get(icon) ?? null;
  }
}
