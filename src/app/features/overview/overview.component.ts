import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Icon, IconService } from '../../core/services/icon.service';
import { ProjectService } from '../../core/services/project.service';
import { ToastService } from '../../core/services/toast.service';
import { SafeHtmlPipe } from '../../shared/pipes/safe-html.pipe';
import { safeSvgPreview } from '../../shared/utils/svg-preview';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, SafeHtmlPipe],
  template: `
    <section class="view active">
      <div class="page-heading">
        <div><div class="eyebrow">YOUR ICON WORKSPACE</div><h1>Good morning, builder.</h1><p>Everything you need to turn SVGs into a production-ready icon library.</p></div>
        <button class="btn btn-primary" type="button" (click)="fileInput.click()">＋ Import icons</button>
      </div>
      <div class="stats">
        <article class="stat-card"><div class="stat-top"><span>Total icons</span><span class="stat-icon">▦</span></div><strong>{{ icons().length }}</strong><small>SVGs in your workspace</small></article>
        <article class="stat-card"><div class="stat-top"><span>Generated outputs</span><span class="stat-icon">↗</span></div><strong>{{ outputCount() }}</strong><small>Files from your last build</small></article>
        <article class="stat-card"><div class="stat-top"><span>Issues detected</span><span class="stat-icon">◇</span></div><strong>{{ issueCount() }}</strong><small>Invalid or unsafe SVGs</small></article>
      </div>
      <div class="section-grid">
        <article class="panel getting-started"><div class="panel-title"><div><h2>Get started</h2><p>Your first icon library, in three steps.</p></div><span class="step-tag">QUICK START</span></div>
          <div class="steps">
            <div class="step"><span class="step-number" [class.done]="icons().length > 0">{{ icons().length ? '✓' : '1' }}</span><div><strong>Import your SVGs</strong><p>Drop a folder of SVG files into your workspace.</p></div><button class="text-btn" type="button" (click)="fileInput.click()">Import →</button></div>
            <div class="step"><span class="step-number" [class.done]="icons().length > 0">{{ icons().length ? '✓' : '2' }}</span><div><strong>Explore and organize</strong><p>Search, preview and rename icons in one place.</p></div><button class="text-btn" type="button" (click)="viewChange.emit('explorer')">Explore →</button></div>
            <div class="step"><span class="step-number" [class.done]="outputCount() > 0">{{ outputCount() ? '✓' : '3' }}</span><div><strong>Build your library</strong><p>Generate a sprite, CSS and a JSON manifest.</p></div><button class="text-btn" type="button" (click)="viewChange.emit('build')">Build →</button></div>
          </div>
        </article>
        <article class="panel recent-panel"><div class="panel-title"><div><h2>Recently added</h2><p>The latest icons in your workspace.</p></div><button class="text-btn" type="button" (click)="viewChange.emit('explorer')">View all →</button></div>
          <div class="recent-list" *ngIf="recentIcons().length; else noIcons">
            <div class="recent-item" *ngFor="let icon of recentIcons()"><div class="recent-preview" [innerHTML]="preview(icon) | safeHtml"></div><div><strong>{{ icon.name }}</strong><small>{{ icon.filename }}</small></div></div>
          </div>
          <ng-template #noIcons><div class="empty-state small"><div class="empty-icon">▦</div><strong>No icons yet</strong><p>Import SVGs to see them here.</p></div></ng-template>
        </article>
      </div>
      <article class="panel drop-panel" [class.dragging]="dragging()" (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
        <div class="drop-icon">↑</div><div><h2>Drop SVG files here</h2><p>Import one or many SVGs. Files are stored in your local workspace.</p></div>
        <button class="btn btn-secondary" type="button" (click)="fileInput.click()">Browse files</button>
        <input #fileInput type="file" accept=".svg,image/svg+xml" multiple hidden (change)="importFiles($event)" />
      </article>
    </section>
  `
})
export class OverviewComponent {
  @Output() viewChange = new EventEmitter<string>();
  private readonly iconService = inject(IconService);
  private readonly projectService = inject(ProjectService);
  private readonly toast = inject(ToastService);
  readonly icons = this.iconService.icons;
  readonly outputCount = () => this.projectService.buildResult()?.generated.length ?? 0;
  readonly issueCount = () => this.icons().filter(icon => !!icon.error).length;
  readonly recentIcons = () => [...this.icons()].slice(-4).reverse();
  readonly dragging = signal(false);


  preview(icon: Icon): string {
    return safeSvgPreview(icon.content);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (event.dataTransfer?.files) this.importList(event.dataTransfer.files);
  }

  importFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.importList(input.files);
    input.value = '';
  }

  private importList(fileList: FileList): void {
    const files = Array.from(fileList).filter(file => file.name.toLowerCase().endsWith('.svg'));
    if (!files.length) {
      this.toast.error('Choose one or more .svg files.');
      return;
    }
    Promise.all(files.map(async file => ({ name: file.name, content: await file.text() }))).then(parsed => {
      this.iconService.importFiles(parsed).subscribe({
        next: result => {
          const skipped = result.skipped.length ? ` ${result.skipped.length} skipped.` : '';
          this.toast.success(`${result.imported} SVG file(s) imported.${skipped}`);
        },
        error: error => this.toast.error(error instanceof Error ? error.message : 'Could not import SVG files.')
      });
    }).catch(() => this.toast.error('Could not read the selected files.'));
  }
}

