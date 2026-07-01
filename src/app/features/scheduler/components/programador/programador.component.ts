import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventInput, DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { FullCalendarComponent } from '@fullcalendar/angular';
import { Subscription } from 'rxjs';
import { SchedulerService } from '../../services/scheduler.service';
import { PostPlanService } from '../../services/post-plan.service';
import { ScheduledPostEvent } from '../../models/scheduled-post.model';
import { PostPlanListItem } from '../../models/post-plan.model';
import { ProgramadorHeaderComponent } from '../programador-header/programador-header.component';
import { ScheduledPostCardComponent } from '../scheduled-post-card/scheduled-post-card.component';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { PostComposerComponent } from '../post-composer/post-composer.component';
import { PostPlanDetailsComponent } from '../post-plan-details/post-plan-details.component';
import { SocialService } from '../../../../core/services/social.service';

@Component({
  selector: 'app-programador',
  standalone: true,
  imports: [
    CommonModule,
    FullCalendarModule,
    ProgramadorHeaderComponent,
    ScheduledPostCardComponent,
    ModalComponent,
    PostComposerComponent,
    PostPlanDetailsComponent
  ],
  templateUrl: './programador.component.html',
  styleUrls: ['./programador.component.scss']
})
export class ProgramadorComponent implements OnInit, OnDestroy {
  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

  currentView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' = 'dayGridMonth';
  currentDateDisplay: string = '';
  scheduledPosts: ScheduledPostEvent[] = [];
  loading = false;
  showCreatePlanModal = false;
  showPlanDetailsModal = false;
  selectedDate?: string; // Fecha seleccionada desde el calendario (ISO string)
  selectedPlanId?: number; // ID del plan seleccionado para ver detalles
  instagramQuotaRemaining: number | null = null;
  private subscriptions = new Subscription();

  calendarOptions: CalendarOptions = {
    initialView: 'dayGridMonth',
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    headerToolbar: false, // Usamos nuestro header personalizado
    locale: esLocale,
    firstDay: 1, // Lunes
    editable: true, // Permite drag & drop
    selectable: true, // Permite seleccionar rangos
    selectMirror: true,
    dayMaxEvents: true,
    weekends: true,
    height: 'auto',
    events: [],
    dateClick: (arg) => this.handleDateClick(arg),
    eventClick: (arg) => this.handleEventClick(arg),
    eventDrop: (arg) => this.handleEventDrop(arg),
    eventResize: (arg) => this.handleEventResize(arg),
    datesSet: (arg) => this.handleDatesSet(arg),
    // eventContent se manejará en el template usando ng-template si es necesario
  };

  constructor(
    private schedulerService: SchedulerService,
    private postPlanService: PostPlanService,
    private social: SocialService
  ) {}

  ngOnInit(): void {
    this.updateDateDisplay();
    this.loadInstagramQuota();
  }

  private loadInstagramQuota(): void {
    const sub = this.social.getProviderGroupStatus('meta').subscribe({
      next: (status) => {
        const remaining = status.minPublishingQuotaRemaining;
        this.instagramQuotaRemaining = typeof remaining === 'number' ? remaining : null;
      },
      error: () => {
        this.instagramQuotaRemaining = null;
      }
    });
    this.subscriptions.add(sub);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /**
   * Maneja el click en una fecha del calendario
   */
  handleDateClick(arg: any): void {
    // Convertir la fecha del calendario a ISO string
    const clickedDate = arg.date;
    this.selectedDate = clickedDate.toISOString();
    this.openNewPostModal();
  }

  /**
   * Maneja el click en un evento/publicación
   */
  handleEventClick(arg: any): void {
    const event = arg.event;
    const extendedProps = event.extendedProps || {};
    
    // Priorizar planId si existe (para PostPlans)
    const planId = extendedProps.planId;
    
    if (planId) {
      // Si es un número, es un planId válido
      if (typeof planId === 'number') {
        this.openPlanDetailsModal(planId);
      } else {
        // Si es string, intentar convertirlo
        const parsedId = parseInt(planId, 10);
        if (!isNaN(parsedId)) {
          this.openPlanDetailsModal(parsedId);
        } else {
          console.warn('planId inválido en el evento:', event);
        }
      }
    } else {
      // Si no hay planId, es un ScheduledPost antiguo
      // TODO: Manejar click en ScheduledPost sin planId
      console.log('Evento sin planId (ScheduledPost antiguo):', event);
    }
  }

  /**
   * Maneja el arrastre de un evento (cambiar fecha)
   */
  handleEventDrop(arg: any): void {
    const postId = arg.event.extendedProps.postId;
    const newDate = arg.event.start;
    
    console.log('Event dropped:', postId, newDate);
    
    // TODO: Actualizar fecha de publicación
    // this.updatePostDate(postId, newDate);
  }

  /**
   * Maneja el redimensionamiento de un evento (cambiar hora)
   */
  handleEventResize(arg: any): void {
    const postId = arg.event.extendedProps.postId;
    const newStart = arg.event.start;
    const newEnd = arg.event.end;
    
    console.log('Event resized:', postId, newStart, newEnd);
    
    // TODO: Actualizar hora de publicación
    // this.updatePostTime(postId, newStart, newEnd);
  }

  /**
   * Maneja el cambio de rango de fechas visible
   */
  handleDatesSet(arg: DatesSetArg): void {
    this.loading = true;
    this.updateDateDisplay(arg);
    
    // Cargar tanto ScheduledPosts como PostPlans
    this.loadAllEvents(arg.start, arg.end);
  }

  /**
   * Carga todos los eventos (ScheduledPosts y PostPlans) para el rango de fechas
   */
  private loadAllEvents(start: Date, end: Date): void {
    // Cargar ScheduledPosts
    const scheduledPostsSubscription = this.schedulerService
      .getScheduledPosts(start, end)
      .subscribe({
        next: (scheduledEvents) => {
          // Cargar PostPlans
          const postPlansSubscription = this.postPlanService
            .getPostPlans(start, end)
            .subscribe({
              next: (postPlansResponse) => {
                // Convertir PostPlans a eventos del calendario
                const postPlanEvents = this.mapPostPlansToEvents(postPlansResponse.data);
                
                // Combinar ambos tipos de eventos
                const allEvents = [...scheduledEvents, ...postPlanEvents];
                
                this.scheduledPosts = allEvents;
                this.updateCalendarEvents(allEvents);
                this.loading = false;
              },
              error: (error) => {
                console.error('Error loading post plans:', error);
                // Si falla cargar PostPlans, mostrar solo ScheduledPosts
                this.scheduledPosts = scheduledEvents;
                this.updateCalendarEvents(scheduledEvents);
                this.loading = false;
              }
            });
          
          this.subscriptions.add(postPlansSubscription);
        },
        error: (error) => {
          console.error('Error loading scheduled posts:', error);
          // Intentar cargar solo PostPlans si ScheduledPosts falla
          const postPlansSubscription = this.postPlanService
            .getPostPlans(start, end)
            .subscribe({
              next: (postPlansResponse) => {
                const postPlanEvents = this.mapPostPlansToEvents(postPlansResponse.data);
                this.scheduledPosts = postPlanEvents;
                this.updateCalendarEvents(postPlanEvents);
                this.loading = false;
              },
              error: (postPlanError) => {
                console.error('Error loading post plans:', postPlanError);
                this.loading = false;
              }
            });
          
          this.subscriptions.add(postPlansSubscription);
        }
      });
    
    this.subscriptions.add(scheduledPostsSubscription);
  }

  /**
   * Convierte PostPlans a eventos del calendario
   */
  private mapPostPlansToEvents(postPlans: PostPlanListItem[]): ScheduledPostEvent[] {
    return postPlans.map(plan => {
      // Construir título con iconos si tiene link o imagen
      let title = plan.title;
      if (plan.hasLink) title = '🔗 ' + title;
      if (plan.hasImage) title = '🖼️ ' + title;
      
      // Agregar resumen de targets al título
      const targetsInfo = `${plan.targetsSummary.published}/${plan.targetsSummary.total}`;
      title = `${title} (${targetsInfo})`;
      
      // Obtener color según el estado del plan
      const colors = this.getColorForPlanStatus(plan.status);
      
      return {
        id: `plan-${plan.id}`,
        title: title,
        start: plan.scheduledAt,
        allDay: false,
        backgroundColor: colors.background,
        borderColor: colors.border,
        textColor: colors.text,
        extendedProps: {
          postId: `plan-${plan.id}`,
          planId: plan.id, // Incluir planId para abrir el modal de detalles
          content: plan.title,
          socialNetwork: 'facebook' as const,
          accountId: '',
          accountName: `Plan #${plan.id}`,
          status: this.mapPlanStatusToPostStatus(plan.status),
          planStatus: plan.status,
          targetsSummary: plan.targetsSummary
        }
      };
    });
  }

  /**
   * Obtiene el color según el estado del plan
   */
  private getColorForPlanStatus(status: string): { background: string; border: string; text: string } {
    const colorMap: Record<string, { background: string; border: string; text: string }> = {
      'Pending': { background: '#fbbf24', border: '#f59e0b', text: '#ffffff' }, // Amarillo
      'Published': { background: '#10b981', border: '#059669', text: '#ffffff' }, // Verde
      'Failed': { background: '#ef4444', border: '#dc2626', text: '#ffffff' }, // Rojo
      'Partial': { background: '#f59e0b', border: '#d97706', text: '#ffffff' }, // Naranja
      'Canceled': { background: '#6b7280', border: '#4b5563', text: '#ffffff' } // Gris
    };
    
    return colorMap[status] || { background: '#6b7280', border: '#4b5563', text: '#ffffff' };
  }

  /**
   * Mapea el estado del plan al estado de publicación
   */
  private mapPlanStatusToPostStatus(planStatus: string): 'scheduled' | 'published' | 'failed' {
    switch (planStatus) {
      case 'Published':
        return 'published';
      case 'Failed':
        return 'failed';
      default:
        return 'scheduled';
    }
  }

  /**
   * Actualiza los eventos del calendario
   */
  private updateCalendarEvents(events: ScheduledPostEvent[]): void {
    const calendarApi = this.calendarComponent.getApi();
    calendarApi.removeAllEvents();
    calendarApi.addEventSource(events);
  }

  /**
   * Actualiza el display de la fecha actual
   */
  private updateDateDisplay(arg?: DatesSetArg): void {
    const calendarApi = this.calendarComponent?.getApi();
    
    if (!calendarApi && !arg) {
      // Fecha inicial
      const now = new Date();
      this.currentDateDisplay = this.formatDateDisplay(now, this.currentView);
      return;
    }

    const view = calendarApi?.view || arg?.view;
    const start = view?.activeStart || new Date();
    
    this.currentDateDisplay = this.formatDateDisplay(start, this.currentView);
  }

  /**
   * Formatea la fecha según la vista actual
   */
  private formatDateDisplay(date: Date, view: string): string {
    const options: Intl.DateTimeFormatOptions = {};
    
    switch (view) {
      case 'dayGridMonth':
        options.month = 'long';
        options.year = 'numeric';
        return date.toLocaleDateString('es-ES', options);
      
      case 'timeGridWeek':
        const weekStart = new Date(date);
        const weekEnd = new Date(date);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return `Semana del ${weekStart.getDate()} al ${weekEnd.getDate()} de ${weekStart.toLocaleDateString('es-ES', { month: 'long' })}`;
      
      case 'timeGridDay':
        options.weekday = 'long';
        options.day = 'numeric';
        options.month = 'long';
        options.year = 'numeric';
        return date.toLocaleDateString('es-ES', options);
      
      default:
        return date.toLocaleDateString('es-ES');
    }
  }

  /**
   * Navegación: Ir a hoy
   */
  goToToday(): void {
    const calendarApi = this.calendarComponent.getApi();
    calendarApi.today();
    this.updateDateDisplay();
  }

  /**
   * Navegación: Anterior
   */
  goToPrevious(): void {
    const calendarApi = this.calendarComponent.getApi();
    calendarApi.prev();
    this.updateDateDisplay();
  }

  /**
   * Navegación: Siguiente
   */
  goToNext(): void {
    const calendarApi = this.calendarComponent.getApi();
    calendarApi.next();
    this.updateDateDisplay();
  }

  /**
   * Cambiar vista del calendario
   */
  changeView(view: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'): void {
    const calendarApi = this.calendarComponent.getApi();
    calendarApi.changeView(view);
    this.currentView = view;
    this.updateDateDisplay();
  }

  /**
   * Abrir modal para nueva publicación
   */
  openNewPostModal(date?: string): void {
    if (date) {
      this.selectedDate = date;
    }
    this.showCreatePlanModal = true;
  }

  /**
   * Cerrar modal de creación de plan
   */
  closeCreatePlanModal(): void {
    this.showCreatePlanModal = false;
    this.selectedDate = undefined;
  }

  /**
   * Abrir modal de detalles del plan
   */
  openPlanDetailsModal(planId: number): void {
    this.selectedPlanId = planId;
    this.showPlanDetailsModal = true;
  }

  /**
   * Cerrar modal de detalles del plan
   */
  closePlanDetailsModal(): void {
    this.showPlanDetailsModal = false;
    this.selectedPlanId = undefined;
  }

  /**
   * Manejar éxito al crear plan
   */
  onPlanCreated(): void {
    this.closeCreatePlanModal();
    // Recargar eventos del calendario
    this.reloadCalendarEvents();
  }

  /**
   * Recarga los eventos del calendario para el rango visible actual
   */
  private reloadCalendarEvents(): void {
    const calendarApi = this.calendarComponent.getApi();
    const view = calendarApi.view;
    const start = view.activeStart;
    const end = view.activeEnd;
    
    // Usar el método loadAllEvents que carga tanto ScheduledPosts como PostPlans
    this.loadAllEvents(start, end);
  }
}
