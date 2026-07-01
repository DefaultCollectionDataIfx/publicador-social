import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/components/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/components/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/components/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/dashboard/components/dashboard-overview/dashboard-overview.component').then(m => m.DashboardOverviewComponent)
      },
      {
        path: 'cuentas-conectadas',
        loadComponent: () => import('./features/dashboard/components/cuentas-conectadas/cuentas-conectadas.component').then(m => m.CuentasConectadasComponent)
      },
      {
        path: 'cuentas-conectadas/facebook',
        loadComponent: () => import('./features/dashboard/components/cuentas-conectadas/cuentas-conectadas.component').then(m => m.CuentasConectadasComponent)
      },
      {
        path: 'cuentas-conectadas/facebook/select',
        loadComponent: () => import('./features/dashboard/components/facebook-page-select/facebook-page-select.component').then(m => m.FacebookPageSelectComponent)
      },
      {
        path: 'cuentas-conectadas/instagram',
        loadComponent: () => import('./features/dashboard/components/cuentas-conectadas/cuentas-conectadas.component').then(m => m.CuentasConectadasComponent)
      },
      {
        path: 'cuentas',
        redirectTo: 'cuentas-conectadas',
        pathMatch: 'full'
      },
      {
        path: 'programador',
        loadComponent: () => import('./features/scheduler/components/programador/programador.component').then(m => m.ProgramadorComponent)
      },
      {
        path: 'analiticas',
        loadComponent: () => import('./features/facebook/components/analytics/analytics.component').then(m => m.AnalyticsComponent)
      },
      {
        path: 'configuracion',
        loadComponent: () => import('./features/dashboard/components/configuracion/configuracion.component').then(m => m.ConfiguracionComponent)
      },
      {
        path: 'mensajes',
        loadComponent: () => import('./features/facebook/components/messaging/messaging-list.component').then(m => m.MessagingListComponent)
      },
      {
        path: 'mensajes/:pageId/:conversationId',
        loadComponent: () => import('./features/facebook/components/messaging/messaging-conversation.component').then(m => m.MessagingConversationComponent)
      },
      {
        path: 'paginas/:pageId',
        loadComponent: () => import('./features/facebook/components/page-detail/page-detail.component').then(m => m.PageDetailComponent)
      },
      {
        path: 'grupos/:groupId',
        loadComponent: () => import('./features/facebook/components/group-detail/group-detail.component').then(m => m.GroupDetailComponent)
      },
      {
        path: 'colecciones',
        loadComponent: () => import('./features/segments/components/segments/segments.component').then(m => m.SegmentsComponent)
      },
      {
        path: 'archivos',
        loadComponent: () => import('./features/media/components/gestor-archivos/gestor-archivos.component').then(m => m.GestorArchivosComponent)
      },
      {
        path: 'archivos/oauth-callback/:provider',
        loadComponent: () => import('./features/media/components/gestor-archivos/gestor-archivos.component').then(m => m.GestorArchivosComponent)
      },
      {
        path: 'publicaciones',
        redirectTo: 'programador',
        pathMatch: 'full'
      },
      {
        path: 'automatizaciones',
        redirectTo: 'programador',
        pathMatch: 'full'
      },
      {
        path: 'integraciones',
        redirectTo: 'cuentas-conectadas',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: 'facebook-callback',
    loadComponent: () => import('./features/facebook/components/facebook-callback/facebook-callback.component').then(m => m.FacebookCallbackComponent)
  },
  {
    path: 'facebook-connected',
    loadComponent: () => import('./features/facebook/components/facebook-success/facebook-success.component').then(m => m.FacebookSuccessComponent)
  },
  {
    path: 'accept-invitation',
    loadComponent: () => import('./features/auth/components/accept-invitation.component').then(m => m.AcceptInvitationComponent)
  }
];
