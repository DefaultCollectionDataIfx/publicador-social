import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { FacebookOAuthService } from '../../../../core/services/facebook-oauth.service';
import { FacebookAnalyticsService } from '../../../facebook/services/facebook-analytics.service';
import { FacebookGroupsService } from '../../../facebook/services/facebook-groups.service';
import { FacebookPage, PageSnapshot, SyncLog, FacebookGroup, GroupSnapshot } from '../../../facebook/models/facebook.model';

interface PageWithSnapshot extends FacebookPage {
  snapshot?: PageSnapshot;
  loadingSnapshot?: boolean;
}

interface GroupWithSnapshot extends FacebookGroup {
  snapshot?: GroupSnapshot;
  loadingSnapshot?: boolean;
}

interface DashboardMetricCard {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

interface DashboardResultCard {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down' | 'neutral';
}

interface DashboardAction {
  label: string;
  description: string;
  route: string;
}

@Component({
  selector: 'app-dashboard-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard-overview.component.html',
  styleUrl: './dashboard-overview.component.scss'
})
export class DashboardOverviewComponent implements OnInit, OnDestroy {
  pages: PageWithSnapshot[] = [];
  groups: GroupWithSnapshot[] = [];
  lastSyncLog: SyncLog | null = null;
  loading = true;
  error: string | null = null;
  syncing = false;
  syncProgress: string = '';
  readonly todayWorkCards: DashboardMetricCard[] = [
    { label: 'Publicaciones programadas hoy', value: '12', hint: '4 en la tarde, 8 en la noche', tone: 'neutral' },
    { label: 'Borradores pendientes', value: '5', hint: '2 listos para revisión', tone: 'warning' },
    { label: 'Mensajes pendientes', value: '18', hint: '7 sin responder > 2h', tone: 'warning' },
    { label: 'Elementos urgentes', value: '3', hint: '2 comentarios y 1 mención crítica', tone: 'danger' }
  ];
  readonly resultsCards: DashboardResultCard[] = [
    { label: 'Alcance', value: '128.4K', delta: '+12.6% vs semana pasada', trend: 'up' },
    { label: 'Engagement', value: '4.8%', delta: '+0.7 pts', trend: 'up' },
    { label: 'Crecimiento', value: '+342', delta: 'nuevos seguidores netos', trend: 'up' },
    { label: 'Top contenido', value: 'Post: Lanzamiento de campaña', delta: '32K alcance | 2.1K interacciones', trend: 'neutral' }
  ];
  readonly quickActions: DashboardAction[] = [
    { label: 'Crear publicación', description: 'Ir al programador y crear contenido', route: '/dashboard/programador' },
    { label: 'Abrir mensajes', description: 'Atender conversaciones pendientes', route: '/dashboard/mensajes' },
    { label: 'Conectar cuenta', description: 'Agregar nueva página o grupo', route: '/dashboard/cuentas-conectadas' },
    { label: 'Ver analítica', description: 'Revisar rendimiento por canal', route: '/dashboard/analiticas' }
  ];
  private subscriptions = new Subscription();

  constructor(
    private facebookService: FacebookOAuthService,
    private analyticsService: FacebookAnalyticsService,
    private groupsService: FacebookGroupsService
  ) {}

  ngOnInit(): void {
    this.loadDashboardData();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get connectedAccountsCount(): number {
    return this.pages.length + this.groups.length;
  }

  get activeAccountsCount(): number {
    const activePages = this.pages.filter(page => page.isActive).length;
    const activeGroups = this.groups.filter(group => group.isActive).length;
    return activePages + activeGroups;
  }

  get errorAccountsCount(): number {
    const inactivePages = this.pages.filter(page => !page.isActive).length;
    const inactiveGroups = this.groups.filter(group => !group.isActive).length;
    return inactivePages + inactiveGroups;
  }

  get automationsActiveCount(): number {
    // Placeholder de diseño hasta conectar el módulo de automatizaciones.
    return 6;
  }

  get systemHealthCards(): DashboardMetricCard[] {
    return [
      {
        label: 'Cuentas activas',
        value: String(this.activeAccountsCount),
        hint: `${this.connectedAccountsCount} cuentas conectadas`,
        tone: 'success'
      },
      {
        label: 'Cuentas con error',
        value: String(this.errorAccountsCount),
        hint: this.lastSyncLog?.pagesFailed ? `${this.lastSyncLog.pagesFailed} fallaron en última sync` : 'Sin fallos críticos reportados',
        tone: this.errorAccountsCount > 0 ? 'danger' : 'neutral'
      },
      {
        label: 'Páginas/grupos conectados',
        value: String(this.connectedAccountsCount),
        hint: `${this.pages.length} páginas y ${this.groups.length} grupos`,
        tone: 'neutral'
      },
      {
        label: 'Automatizaciones activas',
        value: String(this.automationsActiveCount),
        hint: 'Valor hardcodeado para prototipo visual',
        tone: 'warning'
      }
    ];
  }

  /**
   * Carga los datos iniciales del dashboard: páginas, snapshots y último log de sincronización
   */
  loadDashboardData(): void {
    this.loading = true;
    this.error = null;

    // Cargar páginas y último log de sincronización en paralelo
    const pagesObservable = this.facebookService.getConnectedPages().pipe(
      catchError(error => {
        console.error('Error al cargar páginas:', error);
        return of([]);
      })
    );

    const syncLogsObservable = this.analyticsService.getSyncLogs(1).pipe(
      catchError(error => {
        console.error('Error al cargar logs de sincronización:', error);
        return of({ data: [] });
      })
    );

    const groupsObservable = this.groupsService.getGroups().pipe(
      catchError(error => {
        console.error('Error al cargar grupos:', error);
        return of({ data: [], meta: { totalCount: 0, pageSize: 0, currentPage: 0, totalPages: 0, hasNextPage: false, hasPreviusPage: false, nextPageUrl: '', previusPageUrl: '' } });
      })
    );

    const combinedSubscription = forkJoin({
      pages: pagesObservable,
      syncLogs: syncLogsObservable,
      groups: groupsObservable
    }).subscribe({
      next: ({ pages, syncLogs, groups }) => {
        this.pages = pages.map(page => ({
          ...page,
          name: page.name?.trim() || 'Página sin nombre',
          loadingSnapshot: true
        }));
        this.groups = groups.data.map(group => ({
          ...group,
          name: group.name?.trim() || 'Grupo sin nombre',
          loadingSnapshot: true
        }));
        this.lastSyncLog = syncLogs.data.length > 0 ? syncLogs.data[0] : null;

        // Cargar snapshots para cada página y grupo activo
        this.loadSnapshotsForPages();
        this.loadSnapshotsForGroups();
        this.loading = false;
      },
      error: (error) => {
        this.error = error.message || 'Error al cargar los datos del dashboard';
        this.loading = false;
        console.error('Error al cargar datos del dashboard:', error);
      }
    });

    this.subscriptions.add(combinedSubscription);
  }

  /**
   * Carga los snapshots para todas las páginas activas
   */
  private loadSnapshotsForPages(): void {
    this.pages.forEach((page, index) => {
      if (page.isActive) {
        this.loadPageSnapshot(page, index);
      } else {
        page.loadingSnapshot = false;
      }
    });
  }

  /**
   * Carga el snapshot de una página específica
   */
  private loadPageSnapshot(page: PageWithSnapshot, index: number): void {
    const snapshotSubscription = this.analyticsService.getPageSnapshot(page.facebookPageId).subscribe({
      next: (response) => {
        this.pages[index].snapshot = response.data;
        this.pages[index].loadingSnapshot = false;
      },
      error: (error) => {
        // Si no hay snapshot (404), no es un error crítico
        if (error.message.includes('404') || error.message.includes('No se encontraron')) {
          this.pages[index].snapshot = undefined;
        } else {
          console.error(`Error al cargar snapshot para ${page.name}:`, error);
        }
        this.pages[index].loadingSnapshot = false;
      }
    });

    this.subscriptions.add(snapshotSubscription);
  }

  /**
   * Carga los snapshots para todos los grupos activos
   */
  private loadSnapshotsForGroups(): void {
    this.groups.forEach((group, index) => {
      if (group.isActive) {
        this.loadGroupSnapshot(group, index);
      } else {
        group.loadingSnapshot = false;
      }
    });
  }

  /**
   * Carga el snapshot de un grupo específico
   */
  private loadGroupSnapshot(group: GroupWithSnapshot, index: number): void {
    const snapshotSubscription = this.groupsService.getGroupSnapshot(group.facebookGroupId).subscribe({
      next: (response) => {
        this.groups[index].snapshot = response.data;
        this.groups[index].loadingSnapshot = false;
      },
      error: (error) => {
        // Si no hay snapshot (404), no es un error crítico
        if (error.message.includes('404') || error.message.includes('No se encontraron')) {
          this.groups[index].snapshot = undefined;
        } else {
          console.error(`Error al cargar snapshot para ${group.name}:`, error);
        }
        this.groups[index].loadingSnapshot = false;
      }
    });

    this.subscriptions.add(snapshotSubscription);
  }

  /**
   * Sincroniza las métricas de todas las páginas activas
   */
  syncAnalytics(): void {
    if (this.syncing) {
      return;
    }

    this.syncing = true;
    this.syncProgress = 'Iniciando sincronización...';

    const activePageIds = this.pages
      .filter(page => page.isActive)
      .map(page => page.facebookPageId);

    const syncSubscription = this.analyticsService.syncAnalytics({
      pageIds: activePageIds.length > 0 ? activePageIds : undefined,
      onlyActive: true
    }).subscribe({
      next: (response) => {
        this.syncProgress = `Sincronización completada: ${response.data.pagesOk} páginas exitosas, ${response.data.pagesFailed} fallidas`;
        
        // Recargar datos después de la sincronización
        setTimeout(() => {
          this.loadDashboardData();
          this.syncing = false;
          this.syncProgress = '';
        }, 1000);
      },
      error: (error) => {
        this.syncProgress = `Error: ${error.message}`;
        this.syncing = false;
        console.error('Error al sincronizar:', error);
        
        // Ocultar mensaje de error después de 5 segundos
        setTimeout(() => {
          this.syncProgress = '';
        }, 5000);
      }
    });

    this.subscriptions.add(syncSubscription);
  }

  /**
   * Formatea la fecha relativa (ej: "hace 2 horas")
   */
  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'hace menos de un minuto';
    } else if (diffMins < 60) {
      return `hace ${diffMins} ${diffMins === 1 ? 'minuto' : 'minutos'}`;
    } else if (diffHours < 24) {
      return `hace ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
    } else {
      return `hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
    }
  }

  /**
   * Obtiene el estado de la última sincronización como texto
   */
  getSyncStatusText(): string {
    if (!this.lastSyncLog) {
      return 'Nunca sincronizado';
    }

    switch (this.lastSyncLog.status) {
      case 'Completed':
        return `Completada ${this.getTimeAgo(this.lastSyncLog.startedAt)}`;
      case 'Running':
        return 'En progreso...';
      case 'Failed':
        return `Fallida ${this.getTimeAgo(this.lastSyncLog.startedAt)}`;
      case 'Cancelled':
        return `Cancelada ${this.getTimeAgo(this.lastSyncLog.startedAt)}`;
      default:
        return 'Desconocido';
    }
  }

  /**
   * Obtiene la clase CSS para el estado de sincronización
   */
  getSyncStatusClass(): string {
    if (!this.lastSyncLog) {
      return 'status-unknown';
    }

    switch (this.lastSyncLog.status) {
      case 'Completed':
        return 'status-success';
      case 'Running':
        return 'status-running';
      case 'Failed':
        return 'status-error';
      case 'Cancelled':
        return 'status-cancelled';
      default:
        return 'status-unknown';
    }
  }

  getResultTrendClass(trend: DashboardResultCard['trend']): string {
    if (trend === 'up') return 'trend-up';
    if (trend === 'down') return 'trend-down';
    return 'trend-neutral';
  }

  getAccountInitial(name?: string | null): string {
    const trimmed = name?.trim();
    if (!trimmed) {
      return '?';
    }
    return trimmed.charAt(0).toUpperCase();
  }
}
