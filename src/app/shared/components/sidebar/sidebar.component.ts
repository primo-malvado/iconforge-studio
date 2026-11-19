import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">✳</div><div><strong>IconForge</strong><small>STUDIO <span class="local-dot"></span> LOCAL</small></div></div>
      <div class="workspace-label">WORKSPACE</div>
      <button *ngFor="let item of navigation" class="nav" [class.active]="activeView === item.id"
              type="button" (click)="viewChange.emit(item.id)">
        <span>{{ item.icon }}</span>{{ item.label }}
        <span *ngIf="item.id === 'explorer'" class="nav-count">{{ iconCount }}</span>
      </button>
      <div class="sidebar-bottom">
        <div class="privacy-card"><span class="privacy-icon">♧</span><div><strong>Local-first</strong><small>Your icons stay on this machine.</small></div></div>
        <div class="version">IconForge Studio <span>v1.0.0 · Angular</span></div>
      </div>
    </aside>
  `
})
export class SidebarComponent {
  @Input() activeView = 'overview';
  @Input() iconCount = 0;
  @Output() viewChange = new EventEmitter<string>();

  readonly navigation = [
    { id: 'overview', icon: '◫', label: 'Overview' },
    { id: 'explorer', icon: '▦', label: 'Icon Explorer' },
    { id: 'build', icon: '⚙', label: 'Build Studio' },
    { id: 'quality', icon: '◇', label: 'Quality Center' }
  ];
}
