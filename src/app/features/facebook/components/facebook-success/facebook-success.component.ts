import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

/**
 * @deprecated Redirige a Cuentas conectadas; el flujo OAuth actual usa popup Meta.
 */
@Component({
  selector: 'app-facebook-success',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './facebook-success.component.html',
  styleUrl: './facebook-success.component.scss'
})
export class FacebookSuccessComponent implements OnInit {
  constructor(private router: Router) {}

  ngOnInit(): void {
    this.router.navigate(['/dashboard/cuentas-conectadas'], {
      queryParams: { metaOAuth: 'legacy-success' }
    });
  }
}
