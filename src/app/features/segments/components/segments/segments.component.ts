import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SegmentsService } from '../../services/segments.service';
import { FacebookOAuthService } from '../../../../core/services/facebook-oauth.service';
import { SocialService } from '../../../../core/services/social.service';
import { SocialAccount } from '../../../social/models/social.model';
import { TenantEntitlementsResponse } from '../../../../core/models/tenant.model';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import { canUseLimit, getLimitValue, isFeatureEnabled } from '../../../../core/utils/entitlements.utils';
import { FacebookGroupsService } from '../../../facebook/services/facebook-groups.service';
import {
  SegmentListItem,
  SegmentDetail,
  CreateSegmentRequest,
  UpdateSegmentRequest,
  ArchiveSegmentRequest,
  AddItemsToSegmentRequest,
  SegmentItem
} from '../../models/segment.model';
import { FacebookPage } from '../../../facebook/models/facebook.model';
import { FacebookGroup } from '../../../facebook/models/facebook.model';
import { extractErrorMessage } from '../../../../shared/utils/error.utils';
import { markFormGroupTouched } from '../../../../shared/utils/form.utils';

@Component({
  selector: 'app-segments',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './segments.component.html',
  styleUrl: './segments.component.scss'
})
export class SegmentsComponent implements OnInit, OnDestroy {
  segments: SegmentListItem[] = [];
  selectedSegment: SegmentDetail | null = null;
  loading = false;
  error: string | null = null;
  showArchived = false;
  
  // Modales
  showCreateModal = false;
  showEditModal = false;
  showDeleteModal = false;
  showAddItemsModal = false;
  
  // Errores específicos de modales
  createError: string | null = null;
  entitlements: TenantEntitlementsResponse['data'] | null = null;
  entitlementsLoading = false;
  canCreateCollection = true;
  limitGateErrorMessage: string | null = null;
  
  // Formularios
  createForm!: FormGroup;
  editForm!: FormGroup;
  addItemsForm!: FormGroup;
  
  // Estados de carga
  creating = false;
  updating = false;
  deleting = false;
  addingItems = false;
  removingItem = false;
  
  // Datos para agregar items
  availablePages: FacebookPage[] = [];
  availablePageAccounts: SocialAccount[] = [];
  availableGroups: FacebookGroup[] = [];
  selectedPageIds: number[] = [];
  selectedGroupIds: number[] = [];
  loadingAssets = false;
  currentCollectionItems: SegmentItem[] = []; // Items actuales de la colección
  
  // Estado del modal de creación (dos pasos)
  createStep: 1 | 2 = 1;
  searchQuery: string = '';
  activeTab: 'all' | 'pages' | 'groups' = 'all';
  
  private subscriptions = new Subscription();

  constructor(
    private segmentsService: SegmentsService,
    private facebookService: FacebookOAuthService,
    private social: SocialService,
    private groupsService: FacebookGroupsService,
    private fb: FormBuilder,
    private tenantEntitlements: TenantEntitlementsService
  ) {
    this.initForms();
  }

  ngOnInit(): void {
    this.loadSegments();
    this.refreshEntitlements();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private refreshEntitlements(): void {
    this.entitlementsLoading = true;
    const sub = this.tenantEntitlements.refreshCurrentEntitlements().subscribe((data) => {
      this.entitlements = data;
      this.entitlementsLoading = false;
      this.updateCreateCollectionGate();
    });
    this.subscriptions.add(sub);
  }

  private updateCreateCollectionGate(): void {
    if (!this.entitlements) {
      this.canCreateCollection = true;
      this.limitGateErrorMessage = null;
      return;
    }

    if (!isFeatureEnabled(this.entitlements.features, 'module.collections')) {
      this.canCreateCollection = false;
      this.limitGateErrorMessage = 'Tu plan no permite crear colecciones.';
      return;
    }

    const currentCollections = this.entitlements.currentUsage.collections ?? 0;
    const collectionsLimit = getLimitValue(this.entitlements.limits, ['limit.collections']);

    if (!canUseLimit(currentCollections, collectionsLimit, 1)) {
      this.canCreateCollection = false;
      this.limitGateErrorMessage = 'Has alcanzado el límite de colecciones. Actualiza tu plan.';
      return;
    }

    this.canCreateCollection = true;
    this.limitGateErrorMessage = null;
  }

  /**
   * Inicializa los formularios
   */
  private initForms(): void {
    this.createForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
      description: ['']
    });

    this.editForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
      description: [''],
      isArchived: [false]
    });

    this.addItemsForm = this.fb.group({
      socialAssetIds: [[], Validators.required]
    });
  }

  /**
   * Carga la lista de colecciones
   */
  loadSegments(): void {
    this.loading = true;
    this.error = null;

    // Solo enviar archived=true si showArchived es true, de lo contrario undefined (solo activas)
    const archivedParam = this.showArchived ? true : undefined;
    
    const subscription = this.segmentsService.listSegments(archivedParam, true).subscribe({
      next: (segments) => {
        this.segments = segments;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error al cargar colecciones:', error);
        this.error = extractErrorMessage(error, 'Error al cargar las colecciones');
        this.loading = false;
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Carga el detalle de una colección
   */
  loadSegmentDetail(collectionId: number): void {
    this.loading = true;
    const subscription = this.segmentsService.getSegmentDetail(collectionId, true).subscribe({
      next: (detail) => {
        this.selectedSegment = detail;
        this.loading = false;
      },
      error: (error) => {
        this.error = extractErrorMessage(error, 'Error al cargar el detalle de la colección');
        this.loading = false;
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Abre el modal para crear una colección
   */
  openCreateModal(): void {
    if (!this.canCreateCollection) {
      alert(this.limitGateErrorMessage || 'No puedes crear esta colección con tu plan actual.');
      return;
    }
    this.createForm.reset();
    this.createError = null;
    this.createStep = 1;
    this.searchQuery = '';
    this.activeTab = 'all';
    this.selectedPageIds = [];
    this.selectedGroupIds = [];
    this.showCreateModal = true;
  }

  /**
   * Cierra el modal de crear
   */
  closeCreateModal(): void {
    this.showCreateModal = false;
    this.createForm.reset();
    this.createError = null;
    this.createStep = 1;
    this.searchQuery = '';
    this.activeTab = 'all';
    this.selectedPageIds = [];
    this.selectedGroupIds = [];
  }

  /**
   * Avanza al paso 2 del modal de creación (selección de activos)
   */
  goToStep2(): void {
    if (this.createForm.invalid) {
      markFormGroupTouched(this.createForm);
      return;
    }

    this.createStep = 2;
    this.loadAvailableAssets();
  }

  /**
   * Retrocede al paso 1 del modal de creación
   */
  goToStep1(): void {
    this.createStep = 1;
  }

  /**
   * Crea una nueva colección y agrega los items seleccionados
   */
  onCreateSubmit(): void {
    if (this.createForm.invalid) {
      markFormGroupTouched(this.createForm);
      return;
    }

    if (!this.canCreateCollection) {
      this.createError = this.limitGateErrorMessage || 'No puedes crear colecciones con tu plan actual.';
      return;
    }

    this.creating = true;
    this.createError = null;
    
    const request: CreateSegmentRequest = {
      name: this.createForm.value.name.trim(),
      description: this.createForm.value.description?.trim() || undefined
    };

    // Primero crear la colección
    const createSubscription = this.segmentsService.createSegment(request).subscribe({
      next: (response) => {
        // Si hay items seleccionados, agregarlos
        const totalSelected = this.selectedPageIds.length + this.selectedGroupIds.length;
        if (totalSelected > 0) {
          const managedSocialAccountIds = [...this.selectedPageIds];
          if (managedSocialAccountIds.length === 0 && this.selectedGroupIds.length > 0) {
            this.creating = false;
            this.createError =
              'Los grupos de Facebook aún no están disponibles en la API social. Selecciona páginas.';
            return;
          }

          const addItemsSubscription = this.segmentsService
            .addItemsToSegment(response.collectionId, { managedSocialAccountIds })
            .subscribe({
            next: (addResponse) => {
              this.creating = false;
              this.closeCreateModal();
              this.loadSegments();
              this.refreshEntitlements();
            },
            error: (error) => {
              // La colección se creó pero falló al agregar items
              this.creating = false;
              this.createError = extractErrorMessage(error, 'La colección se creó pero hubo un error al agregar los activos');
              // Cerrar el modal después de un tiempo para que el usuario vea el mensaje
              setTimeout(() => {
                this.closeCreateModal();
                this.loadSegments();
              }, 3000);
            }
          });

          this.subscriptions.add(addItemsSubscription);
        } else {
          // No hay items seleccionados, solo cerrar
          this.creating = false;
          this.closeCreateModal();
          this.loadSegments();
          this.refreshEntitlements();
        }
      },
      error: (error) => {
        this.creating = false;
        this.createError = extractErrorMessage(error, 'Error al crear la colección');
      }
    });

    this.subscriptions.add(createSubscription);
  }

  /**
   * Abre el modal para editar una colección
   */
  openEditModal(segment: SegmentListItem): void {
    this.loadSegmentDetail(segment.collectionId);
    this.editForm.patchValue({
      name: segment.name,
      isArchived: false
    });
    this.showEditModal = true;
  }

  /**
   * Cierra el modal de editar
   */
  closeEditModal(): void {
    this.showEditModal = false;
    this.selectedSegment = null;
    this.editForm.reset();
  }

  /**
   * Actualiza una colección
   */
  onEditSubmit(): void {
    if (this.editForm.invalid || !this.selectedSegment) {
      markFormGroupTouched(this.editForm);
      return;
    }

    this.updating = true;
    const request: UpdateSegmentRequest = {
      name: this.editForm.value.name.trim(),
      description: this.editForm.value.description?.trim() || undefined,
      isArchived: this.editForm.value.isArchived
    };

    const subscription = this.segmentsService.updateSegment(
      this.selectedSegment.collectionId,
      request
    ).subscribe({
      next: () => {
        this.updating = false;
        this.closeEditModal();
        this.loadSegments();
      },
      error: (error) => {
        this.updating = false;
        this.error = extractErrorMessage(error, 'Error al actualizar la colección');
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Abre el modal de confirmación para eliminar
   */
  openDeleteModal(segment: SegmentListItem): void {
    this.selectedSegment = {
      collectionId: segment.collectionId,
      name: segment.name
    };
    this.showDeleteModal = true;
  }

  /**
   * Cierra el modal de eliminar
   */
  closeDeleteModal(): void {
    this.showDeleteModal = false;
    this.selectedSegment = null;
  }

  /**
   * Elimina una colección
   */
  confirmDelete(): void {
    if (!this.selectedSegment) return;

    this.deleting = true;
    const subscription = this.segmentsService.deleteSegment(
      this.selectedSegment.collectionId
    ).subscribe({
      next: () => {
        this.deleting = false;
        this.closeDeleteModal();
        this.loadSegments();
      },
      error: (error) => {
        this.deleting = false;
        this.error = extractErrorMessage(error, 'Error al eliminar la colección');
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Archiva o desarchiva una colección
   */
  toggleArchive(segment: SegmentListItem, archive: boolean): void {
    const request: ArchiveSegmentRequest = { isArchived: archive };
    const subscription = this.segmentsService.archiveSegment(segment.collectionId, request).subscribe({
      next: () => {
        this.loadSegments();
      },
      error: (error) => {
        this.error = extractErrorMessage(error, `Error al ${archive ? 'archivar' : 'desarchivar'} la colección`);
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Formatea un número grande
   */
  formatNumber(value: number): string {
    return new Intl.NumberFormat('es-ES').format(value);
  }

  /**
   * Abre el modal para agregar items
   */
  openAddItemsModal(segment: SegmentListItem): void {
    this.selectedSegment = {
      collectionId: segment.collectionId,
      name: segment.name
    };
    this.selectedPageIds = [];
    this.selectedGroupIds = [];
    this.currentCollectionItems = [];
    this.loadingAssets = true;
    this.showAddItemsModal = true;
    
    // Cargar el detalle de la colección para obtener los items actuales
    const detailSub = this.segmentsService.getSegmentDetail(segment.collectionId, true).subscribe({
      next: (detail) => {
        this.currentCollectionItems = detail.items || [];
        // Luego cargar los activos disponibles
        this.loadAvailableAssets();
      },
      error: (error) => {
        console.error('Error al cargar detalle de la colección:', error);
        // Cargar activos de todas formas
        this.loadAvailableAssets();
      }
    });
    
    this.subscriptions.add(detailSub);
  }

  /**
   * Cierra el modal de agregar items
   */
  closeAddItemsModal(): void {
    this.showAddItemsModal = false;
    this.selectedPageIds = [];
    this.selectedGroupIds = [];
    this.currentCollectionItems = [];
    this.addItemsForm.reset();
  }

  /**
   * Carga los activos disponibles (páginas y grupos)
   */
  loadAvailableAssets(): void {
    this.loadingAssets = true;
    
    // Usar forkJoin para esperar a que ambas peticiones terminen
    const pages$ = this.social
      .getAccounts({ providerGroup: 'meta', provider: 'facebook', accountType: 'page' })
      .pipe(
        map((accounts) => accounts.map((a) => this.social.accountToFacebookPage(a))),
        catchError((error) => {
          console.error('Error al cargar páginas:', error);
          return of([]);
        })
      );

    const pageAccounts$ = this.social
      .getAccounts({ providerGroup: 'meta', provider: 'facebook', accountType: 'page' })
      .pipe(
        catchError((error) => {
          console.error('Error al cargar cuentas:', error);
          return of([]);
        })
      );

    const groups$ = this.groupsService.getGroups().pipe(
      catchError(error => {
        console.error('Error al cargar grupos:', error);
        return of({ data: [] }); // Retornar objeto con data vacía en caso de error
      })
    );

    const subscription = forkJoin({
      pages: pages$,
      pageAccounts: pageAccounts$,
      groups: groups$
    }).subscribe({
      next: ({ pages, pageAccounts, groups }) => {
        this.availablePageAccounts = pageAccounts.filter((a) => a.isActive);
        this.availablePages = pages.filter((p) => p.isActive);
        this.availableGroups = groups.data.filter((g) => g.isActive);
        this.loadingAssets = false;
      },
      error: (error) => {
        console.error('Error al cargar activos:', error);
        this.loadingAssets = false;
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Toggle selección de una página
   */
  togglePageSelection(pageId: number): void {
    const index = this.selectedPageIds.indexOf(pageId);
    if (index > -1) {
      this.selectedPageIds.splice(index, 1);
    } else {
      this.selectedPageIds.push(pageId);
    }
  }

  /**
   * Toggle selección de un grupo
   */
  toggleGroupSelection(groupId: number): void {
    const index = this.selectedGroupIds.indexOf(groupId);
    if (index > -1) {
      this.selectedGroupIds.splice(index, 1);
    } else {
      this.selectedGroupIds.push(groupId);
    }
  }

  /**
   * Verifica si una página está seleccionada
   */
  isPageSelected(pageId: number): boolean {
    return this.selectedPageIds.includes(pageId);
  }

  /**
   * Verifica si un grupo está seleccionado
   */
  isGroupSelected(groupId: number): boolean {
    return this.selectedGroupIds.includes(groupId);
  }

  /**
   * Obtiene el total de items seleccionados
   */
  getTotalSelectedCount(): number {
    return this.selectedPageIds.length + this.selectedGroupIds.length;
  }

  /**
   * Agrega items a la colección
   */
  onAddItemsSubmit(): void {
    const totalSelected = this.selectedPageIds.length + this.selectedGroupIds.length;
    if (totalSelected === 0 || !this.selectedSegment) {
      return;
    }

    this.addingItems = true;

    if (this.selectedPageIds.length === 0) {
      this.addingItems = false;
      alert('Solo se pueden agregar páginas de Facebook vía cuentas sociales. Los grupos no están disponibles aún.');
      return;
    }

    const subscription = this.segmentsService
      .addItemsToSegment(this.selectedSegment.collectionId, {
        managedSocialAccountIds: this.selectedPageIds
      })
      .subscribe({
      next: (response) => {
        this.addingItems = false;
        this.closeAddItemsModal();
        this.loadSegments();
        if (this.selectedSegment) {
          this.loadSegmentDetail(this.selectedSegment.collectionId);
        }
        alert(`Se agregaron ${response.added} items. ${response.skippedDuplicates > 0 ? `${response.skippedDuplicates} duplicados omitidos.` : ''}`);
      },
      error: (error) => {
        this.addingItems = false;
        this.error = extractErrorMessage(error, 'Error al agregar items a la colección');
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Quita un item de la colección
   */
  removeItemFromSegment(item: SegmentItem): void {
    if (!this.selectedSegment || this.removingItem) return;

    if (!confirm(`¿Estás seguro de que deseas quitar "${item.name}" de la colección?`)) {
      return;
    }

    this.removingItem = true;
    const subscription = this.segmentsService.removeItemFromSegment(
      this.selectedSegment.collectionId,
      item.socialAssetId
    ).subscribe({
      next: () => {
        this.removingItem = false;
        if (this.selectedSegment) {
          this.loadSegmentDetail(this.selectedSegment.collectionId);
        }
        this.loadSegments();
      },
      error: (error) => {
        this.removingItem = false;
        this.error = extractErrorMessage(error, 'Error al quitar el item de la colección');
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Formatea una fecha
   */
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Obtiene el tiempo transcurrido desde una fecha
   */
  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return 'hace unos segundos';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
    }
  }

  /**
   * Obtiene el ID numérico de una página para usar en pageIds
   * 
   * Nota: El modelo FacebookPage no incluye un campo 'id' numérico directamente.
   * Este método intenta obtener el ID desde campos extendidos del objeto.
   * Si el backend devuelve el ID en la respuesta, debería estar disponible aquí.
   * 
   * Si este método retorna 0, significa que no se pudo obtener el ID y la página
   * no se podrá agregar a la colección. En ese caso, sería necesario que el backend
   * incluya el ID numérico en la respuesta de GET /api/Facebook/pages.
   */
  getPageAssetId(page: FacebookPage): number {
    const account = this.availablePageAccounts.find(
      (a) => a.externalAccountId === page.facebookPageId
    );
    return account?.id ?? 0;
  }

  /**
   * Filtra las páginas según la búsqueda y el tab activo
   */
  getFilteredPages(): FacebookPage[] {
    let filtered = this.availablePages;

    // Filtrar por búsqueda
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(page => 
        page.name.toLowerCase().includes(query) ||
        page.facebookPageId?.toString().includes(query)
      );
    }

    return filtered;
  }

  /**
   * Filtra los grupos según la búsqueda y el tab activo
   */
  getFilteredGroups(): FacebookGroup[] {
    let filtered = this.availableGroups;

    // Filtrar por búsqueda
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(group => 
        group.name.toLowerCase().includes(query) ||
        group.facebookGroupId?.toString().includes(query)
      );
    }

    return filtered;
  }

  /**
   * Obtiene todos los activos filtrados (páginas y grupos) según el tab activo
   */
  getAllFilteredAssets(): Array<{type: 'page' | 'group', page?: FacebookPage, group?: FacebookGroup, id: number}> {
    const assets: Array<{type: 'page' | 'group', page?: FacebookPage, group?: FacebookGroup, id: number}> = [];

    if (this.activeTab === 'all' || this.activeTab === 'pages') {
      this.getFilteredPages().forEach(page => {
        assets.push({
          type: 'page',
          page,
          id: this.getPageAssetId(page)
        });
      });
    }

    if (this.activeTab === 'all' || this.activeTab === 'groups') {
      this.getFilteredGroups().forEach(group => {
        assets.push({
          type: 'group',
          group,
          id: group.id
        });
      });
    }

    return assets;
  }

  /**
   * Verifica si un activo está seleccionado
   */
  isAssetSelected(assetId: number, type: 'page' | 'group'): boolean {
    if (type === 'page') {
      return this.selectedPageIds.includes(assetId);
    } else {
      return this.selectedGroupIds.includes(assetId);
    }
  }

  /**
   * Toggle selección de un activo
   */
  toggleAssetSelection(assetId: number, type: 'page' | 'group'): void {
    if (type === 'page') {
      this.togglePageSelection(assetId);
    } else {
      this.toggleGroupSelection(assetId);
    }
  }

  /**
   * Obtiene la inicial de un activo para el placeholder
   */
  getAssetInitial(asset: {type: 'page' | 'group', page?: FacebookPage, group?: FacebookGroup}): string {
    const name = asset.type === 'page' ? asset.page?.name : asset.group?.name;
    return name?.charAt(0)?.toUpperCase() || '?';
  }

  /**
   * Verifica si una página ya está en la colección
   * Compara usando el socialAssetId del SegmentItem con el ID numérico de la página
   */
  isPageInCollection(pageId: number): boolean {
    if (pageId <= 0) return false;
    
    return this.currentCollectionItems.some(item => 
      item.assetType === 'page' && item.socialAssetId === pageId
    );
  }

  /**
   * Verifica si un grupo ya está en la colección
   * Compara usando el socialAssetId del SegmentItem con el ID del grupo
   */
  isGroupInCollection(groupId: number): boolean {
    if (groupId <= 0) return false;
    
    return this.currentCollectionItems.some(item => 
      item.assetType === 'group' && item.socialAssetId === groupId
    );
  }

  /**
   * Filtra las páginas disponibles (excluyendo las que ya están en la colección)
   */
  getAvailablePagesForAdd(): FacebookPage[] {
    return this.availablePages.filter(page => {
      const pageId = this.getPageAssetId(page);
      return pageId > 0 && !this.isPageInCollection(pageId);
    });
  }

  /**
   * Filtra los grupos disponibles (excluyendo los que ya están en la colección)
   */
  getAvailableGroupsForAdd(): FacebookGroup[] {
    return this.availableGroups.filter(group => !this.isGroupInCollection(group.id));
  }

  /**
   * Verifica si un activo (página o grupo) ya está en la colección
   */
  isAssetInCollection(assetId: number, type: 'page' | 'group'): boolean {
    if (type === 'page') {
      return this.isPageInCollection(assetId);
    } else {
      return this.isGroupInCollection(assetId);
    }
  }
}
