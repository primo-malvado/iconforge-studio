import { Component, HostListener, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconService } from './core/services/icon.service';
import { ProjectService } from './core/services/project.service';
import { ToastService } from './core/services/toast.service';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { TopbarComponent } from './shared/components/topbar/topbar.component';
import { ToastComponent } from './shared/components/toast/toast.component';
import { OverviewComponent } from './features/overview/overview.component';
import { ExplorerComponent } from './features/explorer/explorer.component';
import { BuildComponent } from './features/build/build.component';
import { QualityComponent } from './features/quality/quality.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    SidebarComponent,
    TopbarComponent,
    ToastComponent,
    OverviewComponent,
    ExplorerComponent,
    BuildComponent,
    QualityComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  readonly currentView = signal('overview');
  readonly iconCount = () => this.icons.icons().length;

  constructor(private readonly icons: IconService, private readonly projects: ProjectService, private readonly toast: ToastService) {}

  ngOnInit(): void {
    this.icons.loadIcons().subscribe({ error: error => this.toast.error(this.message(error)) });
    this.projects.loadConfig().subscribe({
      next: config => document.title = `${config.projectName} · IconForge Studio`,
      error: error => this.toast.error(this.message(error))
    });
  }

  switchView(view: string): void {
    this.currentView.set(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.switchView('explorer');
      queueMicrotask(() => document.querySelector<HTMLInputElement>('.searchbox input')?.focus());
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !typing && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.changeHistory(event.shiftKey ? 'redo' : 'undo');
    } else if ((event.ctrlKey || event.metaKey) && !typing && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.changeHistory('redo');
    }
  }

  private changeHistory(action: 'undo' | 'redo'): void {
    const request = action === 'undo' ? this.projects.undo() : this.projects.redo();
    request.subscribe({
      next: () => {
        this.icons.clearSelection();
        this.icons.loadIcons().subscribe({ error: error => this.toast.error(this.message(error)) });
        this.toast.success(action === 'undo' ? 'Last library change undone.' : 'Last change restored.');
      },
      error: error => this.toast.error(this.message(error))
    });
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'The request could not be completed.';
  }
}
