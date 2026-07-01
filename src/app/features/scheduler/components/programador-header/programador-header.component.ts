import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ViewOption {
  label: string;
  value: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
}

@Component({
  selector: 'app-programador-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './programador-header.component.html',
  styleUrls: ['./programador-header.component.scss']
})
export class ProgramadorHeaderComponent {
  @Input() currentView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' = 'dayGridMonth';
  @Input() currentDateDisplay: string = '';
  @Input() instagramQuotaRemaining: number | null = null;
  
  @Output() previous = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() today = new EventEmitter<void>();
  @Output() viewChange = new EventEmitter<'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'>();
  @Output() newPost = new EventEmitter<void>();

  views: ViewOption[] = [
    { label: 'Mes', value: 'dayGridMonth' },
    { label: 'Semana', value: 'timeGridWeek' },
    { label: 'Día', value: 'timeGridDay' }
  ];

  onPrevious(): void {
    this.previous.emit();
  }

  onNext(): void {
    this.next.emit();
  }

  onToday(): void {
    this.today.emit();
  }

  onViewChange(view: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'): void {
    this.viewChange.emit(view);
  }

  onNewPost(): void {
    this.newPost.emit();
  }
}
