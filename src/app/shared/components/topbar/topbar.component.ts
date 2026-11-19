import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconService } from '../../../core/services/icon.service';
import { ProjectService } from '../../../core/services/project.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="topbar">
      <div class="crumb"><span>Workspace</span><b>/</b><strong>{{ viewLabel }}</strong></div>
      <div class="top-actions">
        <span class="server-status"><i></i> Running locally</span>
        <button class="btn btn-quiet" type="button" title="Undo last library change" [disabled]="!history().canUndo" (click)="changeHistory('undo')">↶ Undo</button>
        <button class="btn btn-quiet" type="button" title="Redo last library change" [disabled]="!history().canRedo" (click)="changeHistory('redo')">↷ Redo</button>
        <button class="btn btn-quiet" type="button" title="Refresh workspace" [disabled]="refreshing()" (click)="refresh()">↻ Refresh</button>
      </div>
    </header>
  `
})
export class TopbarComponent implements OnInit {
  @Input() currentView = 'overview';
  private readonly icons = inject(IconService);
  private readonly project = inject(ProjectService);
  private readonly toast = inject(ToastService);
  readonly history = this.project.history;
  readonly refreshing = signal(false);


  get viewLabel(): string {
    return ({ overview: 'Overview', explorer: 'Icon Explorer', build: 'Build Studio', quality: 'Quality Center' } as Record<string, string>)[this.currentView] ?? 'Overview';
  }

  ngOnInit(): void {
    this.loadHistory();
  }

  loadHistory(): void {
    this.project.refreshHistory().subscribe({ error: () => undefined });
  }

  changeHistory(action: 'undo' | 'redo'): void {
    const request = action === 'undo' ? this.project.undo() : this.project.redo();
    request.subscribe({
      next: () => {
        this.icons.loadIcons().subscribe({ next: () => this.loadHistory(), error: error => this.toast.error(this.message(error)) });
        this.icons.clearSelection();
        this.toast.success(action === 'undo' ? 'Last library change undone.' : 'Last change restored.');
      },
      error: error => this.toast.error(this.message(error))
    });
  }

  refresh(): void {
    this.refreshing.set(true);
    this.icons.loadIcons().subscribe({
      next: () => {
        this.loadHistory();
        this.toast.success('Workspace refreshed.');
        this.refreshing.set(false);
      },
      error: error => {
        this.toast.error(this.message(error));
        this.refreshing.set(false);
      }
    });
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'The request could not be completed.';
  }
}
