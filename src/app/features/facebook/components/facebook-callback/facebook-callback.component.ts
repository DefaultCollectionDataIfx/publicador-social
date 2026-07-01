import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

/**
 * @deprecated El OAuth de Meta ya no redirige al SPA. Usar MetaConnectService.openOAuthPopup.
 */
@Component({
  selector: 'app-facebook-callback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './facebook-callback.component.html',
  styleUrl: './facebook-callback.component.scss'
})
export class FacebookCallbackComponent implements OnInit {
  loading = true;

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.router.navigate(['/dashboard/cuentas-conectadas'], {
      queryParams: { metaOAuth: 'legacy-callback' }
    });
  }
}
