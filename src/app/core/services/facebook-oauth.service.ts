import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  FacebookPage,
  FacebookPagesResponse,
  PageOverviewResponse,
  UpdatePageStatusResponse
} from '../../features/facebook/models/facebook.model';
import { MetaConnectService } from './meta-connect.service';
import { SocialService } from './social.service';

@Injectable({
  providedIn: 'root'
})
export class FacebookOAuthService {
  private readonly apiUrl = '/api/Facebook';

  constructor(
    private http: HttpClient,
    private metaConnect: MetaConnectService,
    private social: SocialService
  ) {}

  /**
   * @deprecated Usar MetaConnectService.connectFacebookWithPopup()
   */
  connectFacebook(): void {
    this.metaConnect.connectFacebookWithPopup().subscribe({
      error: (error) => {
        console.error('Error al conectar Facebook:', error);
      }
    });
  }

  getConnectedPages(): Observable<FacebookPage[]> {
    return this.social
      .getAccounts({ providerGroup: 'meta', provider: 'facebook', accountType: 'page' })
      .pipe(map((accounts) => accounts.map((a) => this.social.accountToFacebookPage(a))));
  }

  getConnectedPagesWithMeta(): Observable<FacebookPagesResponse> {
    return this.social
      .getAccounts({ providerGroup: 'meta', provider: 'facebook', accountType: 'page' })
      .pipe(
        map((accounts) => ({
          data: accounts.map((a) => this.social.accountToFacebookPage(a)),
          meta: {
            totalCount: accounts.length,
            pageSize: accounts.length,
            currentPage: 1,
            totalPages: 1,
            hasNextPage: false,
            hasPreviusPage: false,
            nextPageUrl: '',
            previusPageUrl: ''
          }
        }))
      );
  }

  updatePageStatus(facebookPageId: string, isActive: boolean): Observable<UpdatePageStatusResponse> {
    return this.social
      .getAccounts({ providerGroup: 'meta', provider: 'facebook', accountType: 'page' })
      .pipe(
        map((accounts) => accounts.find((a) => a.externalAccountId === facebookPageId)),
        switchMap((account) => {
          if (!account) {
            return throwError(() => new Error('Página no encontrada.'));
          }
          return this.social.updateAccountStatus(account.id, isActive);
        }),
        map((updated) => ({
          data: this.social.accountToFacebookPage(updated),
          meta: {
            totalCount: 1,
            pageSize: 1,
            currentPage: 1,
            totalPages: 1,
            hasNextPage: false,
            hasPreviusPage: false,
            nextPageUrl: '',
            previusPageUrl: ''
          }
        })),
        catchError(this.handleError)
      );
  }

  /**
   * @deprecated Sin endpoint en API social; fuera de alcance.
   */
  getPageOverview(facebookPageId: string, recentPostsLimit?: number): Observable<PageOverviewResponse> {
    let url = `${this.apiUrl}/pages/${facebookPageId}/overview`;

    if (recentPostsLimit !== undefined) {
      url += `?recentPostsLimit=${recentPostsLimit}`;
    }

    return this.http.get<PageOverviewResponse>(url).pipe(catchError(this.handleError));
  }

  private handleError = (error: HttpErrorResponse) => {
    let errorMessage = 'Error desconocido';

    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      switch (error.status) {
        case 401:
          errorMessage = 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
          break;
        case 400:
          errorMessage = error.error?.message || 'Solicitud inválida.';
          break;
        case 500:
          errorMessage = 'Error del servidor. Por favor, intenta más tarde.';
          break;
        default:
          errorMessage = `Error ${error.status}: ${error.message}`;
      }
    }

    return throwError(() => new Error(errorMessage));
  };
}
