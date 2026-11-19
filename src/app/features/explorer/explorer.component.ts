import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Icon, IconService } from '../../core/services/icon.service';
import { ToastService } from '../../core/services/toast.service';
import { SafeHtmlPipe } from '../../shared/pipes/safe-html.pipe';
import { safeSvgPreview } from '../../shared/utils/svg-preview';

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [CommonModule, SafeHtmlPipe],
  template: `
    <section class="view active">
      <div class="page-heading"><div><div class="eyebrow">COLLECTION MANAGEMENT</div><h1>Icon Explorer</h1><p>Find, inspect and manage every icon in your collection.</p></div><button class="btn btn-primary" type="button" (click)="fileInput.click()">＋ Import icons</button></div>
      <div class="toolbar">
        <div class="searchbox"><span>⌕</span><input type="search" placeholder="Search icons by name..." autocomplete="off" [value]="iconService.search()" (input)="setSearch($event)" /></div>
        <select aria-label="Sort icons" [value]="iconService.sort()" (change)="setSort($event)"><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option></select>
        <button class="btn btn-secondary" type="button" (click)="selectAll()">{{ allSelected() ? 'Clear selection' : 'Select all' }}</button>
        <button class="btn btn-secondary" type="button" [class.hidden]="!iconService.selected().size" (click)="convertSelected()">Convert shapes to paths</button>
        <button class="btn btn-danger" type="button" [class.hidden]="!iconService.selected().size" (click)="deleteSelected()">Delete selected</button>
        <input #fileInput type="file" accept=".svg,image/svg+xml" multiple hidden (change)="importFiles($event)" />
      </div>
      <div class="explorer-meta"><span>{{ filteredIcons().length }} {{ filteredIcons().length === 1 ? 'icon' : 'icons' }}</span><span>{{ iconService.selected().size ? iconService.selected().size + ' selected' : 'Nothing selected' }}</span></div>
      <div class="icon-grid" [class.hidden]="!filteredIcons().length">
        <article *ngFor="let icon of filteredIcons(); trackBy: trackIcon" class="icon-card" [class.selected]="isSelected(icon)"
                 tabindex="0" role="checkbox" [attr.aria-checked]="isSelected(icon)" (click)="toggle(icon)" (keydown)="onKeydown($event, icon)" (contextmenu)="rename($event, icon)">
          <span class="icon-check">{{ isSelected(icon) ? '✓' : '' }}</span><div class="icon-preview" [innerHTML]="preview(icon) | safeHtml"></div>
          <span class="icon-name" [title]="icon.name">{{ icon.name }}</span><span class="icon-sub">{{ icon.error ? 'Needs attention' : icon.viewBox }}</span>
        </article>
      </div>
      <div class="empty-state" [class.hidden]="filteredIcons().length > 0"><div class="empty-icon">▦</div><strong>No icons found</strong><p>Import SVGs or try a different search.</p><button class="btn btn-secondary" type="button" (click)="fileInput.click()">Import SVGs</button></div>
    </section>
  `
})
export class ExplorerComponent {
  constructor(readonly iconService: IconService, private readonly toast: ToastService) {}

  filteredIcons() {
    return this.iconService.filteredIcons();
  }

  trackIcon(_index: number, icon: Icon): string {
    return icon.filename;
  }

  preview(icon: Icon): string {
    return safeSvgPreview(icon.content);
  }

  isSelected(icon: Icon): boolean {
    return this.iconService.selected().has(icon.filename);
  }

  allSelected(): boolean {
    const visible = this.filteredIcons();
    return visible.length > 0 && visible.every(icon => this.isSelected(icon));
  }

  selectAll(): void {
    this.iconService.toggleAllVisible();
  }

  setSearch(event: Event): void {
    this.iconService.setSearch((event.target as HTMLInputElement).value);
  }

  setSort(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.iconService.setSort(value === 'name-desc' ? value : 'name');
  }

  toggle(icon: Icon): void {
    this.iconService.toggleSelected(icon.filename);
  }

  onKeydown(event: KeyboardEvent, icon: Icon): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggle(icon);
    }
  }

  rename(event: MouseEvent, icon: Icon): void {
    event.preventDefault();
    const newName = window.prompt('New icon name (without .svg):', icon.name);
    if (newName === null) return;
    if (!newName.trim()) {
      this.toast.error('Name cannot be empty.');
      return;
    }
    this.iconService.rename(icon.filename, newName.trim()).subscribe({
      next: () => this.toast.success('Icon renamed.'),
      error: error => this.toast.error(error instanceof Error ? error.message : 'Could not rename icon.')
    });
  }

  deleteSelected(): void {
    const count = this.iconService.selected().size;
    if (!count || !window.confirm(`Delete ${count} selected SVG file(s)? This action can be undone.`)) return;
    this.iconService.deleteSelected().subscribe({
      next: () => this.toast.success(`${count} file(s) deleted.`),
      error: error => this.toast.error(error instanceof Error ? error.message : 'Could not delete the selected icons.')
    });
  }

  convertSelected(): void {
    const count = this.iconService.selected().size;
    if (!count || !window.confirm(`Convert basic SVG shapes to paths in ${count} selected file(s)?`)) return;
    this.iconService.convertSelectedShapes().subscribe({
      next: result => {
        if (result.convertedShapes) this.toast.success(`Converted ${result.convertedShapes} shape(s) across ${result.convertedIcons} icon(s).`);
        else this.toast.info('No convertible basic shapes found in the selection.');
      },
      error: error => this.toast.error(error instanceof Error ? error.message : 'Could not convert SVG shapes.')
    });
  }

  importFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter(file => file.name.toLowerCase().endsWith('.svg'));
    input.value = '';
    if (!files.length) {
      this.toast.error('Choose one or more .svg files.');
      return;
    }
    Promise.all(files.map(async file => ({ name: file.name, content: await file.text() }))).then(parsed => {
      this.iconService.importFiles(parsed).subscribe({
        next: result => this.toast.success(`${result.imported} SVG file(s) imported.${result.skipped.length ? ` ${result.skipped.length} skipped.` : ''}`),
        error: error => this.toast.error(error instanceof Error ? error.message : 'Could not import SVG files.')
      });
    }).catch(() => this.toast.error('Could not read the selected files.'));
  }
}
