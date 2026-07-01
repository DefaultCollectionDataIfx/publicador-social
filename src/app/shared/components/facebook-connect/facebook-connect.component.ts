import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetaConnectComponent } from '../meta-connect/meta-connect.component';
import { SocialConnectionType } from '../../../features/social/models/social.model';

/** @deprecated Usar app-meta-connect directamente */
@Component({
  selector: 'app-facebook-connect',
  standalone: true,
  imports: [CommonModule, MetaConnectComponent],
  template: `
    <app-meta-connect
      connectionType="facebook_login"
      label="Conectar Facebook"
      (connectionSuccess)="connectionSuccess.emit($event)"
      (connectionError)="connectionError.emit($event)">
    </app-meta-connect>
  `
})
export class FacebookConnectComponent {
  @Output() connectionSuccess = new EventEmitter<SocialConnectionType>();
  @Output() connectionError = new EventEmitter<string>();
}
