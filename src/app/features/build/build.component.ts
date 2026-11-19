import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectConfig, ProjectService, FontPreview } from '../../core/services/project.service';
import { ToastService } from '../../core/services/toast.service';
import { environment } from '../../../environments/environment';

interface FormatOption {
  id: string;
  name: string;
  description: string;
  extension: string;
  icon: string;
}

@Component({
  selector: 'app-build',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="view active">
      <div class="page-heading"><div><div class="eyebrow">OUTPUT GENERATION</div><h1>Build Studio</h1><p>Choose your outputs. IconForge handles the rest.</p></div><span class="pill"><i></i> Local build</span></div>
      <article class="panel project-settings">
        <div class="panel-title"><div><h2>Project settings</h2><p>Saved locally and reused for future builds.</p></div><button class="btn btn-secondary" type="button" [disabled]="saving() || !config()" (click)="saveSettings()">{{ saving() ? 'Saving…' : 'Save settings' }}</button></div>
        <div class="settings-grid">
          <label><span>Project name</span><input maxlength="80" placeholder="IconForge Project" [value]="config()?.projectName ?? ''" (input)="setConfig('projectName', $event)" /></label>
          <label><span>Font family</span><input maxlength="80" placeholder="IconForge Icons" [value]="config()?.fontFamily ?? ''" (input)="setConfig('fontFamily', $event)" /></label>
          <label><span>CSS class prefix</span><input maxlength="40" placeholder="icon" [value]="config()?.cssPrefix ?? ''" (input)="setConfig('cssPrefix', $event)" /></label>
          <label class="settings-check"><input type="checkbox" [checked]="config()?.defaultOptimize ?? true" (change)="setConfigBoolean('defaultOptimize', $event)" /><span>Optimize by default</span></label>
        </div>
        <p class="settings-note">The selected output formats are also saved as the default set when you save these settings.</p>
      </article>
      <div class="build-layout">
        <article class="panel format-panel">
          <div class="panel-title"><div><h2>Output formats</h2><p>Select the artefacts you want to generate.</p></div></div>
          <label class="preset-row" for="buildPreset"><span>Build preset</span><select id="buildPreset" [value]="preset()" (change)="applyPreset($event)"><option value="custom">Custom selection</option><option value="web">Web basics</option><option value="react">React package</option><option value="vue">Vue components</option><option value="angular">Angular components</option><option value="everything">Everything</option></select></label>
          <label *ngFor="let format of formats" class="format-option"><input type="checkbox" [checked]="selectedFormats().has(format.id)" (change)="toggleFormat(format.id)" /><span class="format-symbol">{{ format.icon }}</span><span class="format-copy"><strong>{{ format.name }}</strong><small>{{ format.description }}</small></span><span class="format-ext">{{ format.extension }}</span></label>
          <label class="format-option"><input type="checkbox" [checked]="optimize()" (change)="optimize.set($any($event.target).checked)" /><span class="format-symbol">✧</span><span class="format-copy"><strong>Optimize SVG markup</strong><small>Uses SVGO when installed; otherwise applies conservative markup cleanup.</small></span><span class="format-ext">OPTION</span></label>
          <div class="build-actions"><button class="btn btn-primary btn-large" type="button" [disabled]="building() || !selectedFormats().size" (click)="build()">{{ building() ? 'Generating…' : '⚡ Generate library' }}</button><button class="btn btn-secondary" type="button" (click)="exportZip()">↓ Export ZIP</button><span>Files stay on your machine.</span></div>
        </article>
        <article class="panel build-summary">
          <div class="panel-title"><div><h2>Build summary</h2><p>Your latest generation.</p></div><span class="status-dot" [class.success]="!!result()"></span></div>
          <ng-container *ngIf="result() as latest; else noBuild">
            <div class="summary-number"><strong>{{ latest.iconCount }}</strong><span>valid icons included</span></div>
            <div class="summary-line"><span>Output directory</span><code>{{ latest.outputDirectory }}</code></div>
            <div class="summary-line"><span>Generated files</span><strong>{{ latest.generated.length }}</strong></div>
            <div class="output-list"><div *ngFor="let file of latest.generated" class="output-item"><span class="file-badge">{{ extension(file) }}</span><span>{{ file }}</span></div></div>
            <div class="build-message">Build completed. {{ latest.iconCount }} valid icon(s) processed using {{ latest.optimizer }}.</div>
          </ng-container>
          <ng-template #noBuild><div class="empty-state small"><div class="empty-icon">⚙</div><strong>Ready to build</strong><p>Select output formats and generate your library.</p></div></ng-template>
          <div *ngIf="buildError()" class="build-message error">{{ buildError() }}</div>
        </article>
      </div>
      <article class="panel font-preview-panel" [class.hidden]="!fontPreview()?.available">
        <div class="panel-title"><div><h2>Generated font preview</h2><p>{{ fontPreview()?.icons?.length ?? 0 }} glyph(s) · Unicode private-use area · Select a code point to copy.</p></div><span class="font-family-pill">{{ fontPreview()?.family }}</span></div>
        <div class="font-preview-grid"><div *ngFor="let glyph of fontPreview()?.icons" class="font-glyph-card" [title]="glyph.name"><span class="font-glyph" [style.font-family]="fontFamilyCss()">{{ glyphCharacter(glyph.codepoint) }}</span><span class="font-glyph-name">{{ glyph.name }}</span><button type="button" class="text-btn font-copy-code" (click)="copyCodepoint(glyph.codepoint)">U+{{ glyph.hex }}</button></div></div>
      </article>
    </section>
  `
})
export class BuildComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly toast = inject(ToastService);
  readonly config = signal<ProjectConfig | null>(null);
  readonly result = this.projectService.buildResult;
  readonly selectedFormats = signal(new Set<string>(['sprite', 'css', 'json']));
  readonly optimize = signal(true);
  readonly preset = signal('custom');
  readonly building = signal(false);
  readonly saving = signal(false);
  readonly buildError = signal<string | null>(null);
  readonly fontPreview = signal<FontPreview | null>(null);
  readonly formats: FormatOption[] = [
    { id: 'sprite', name: 'SVG Sprite', description: 'One file containing reusable symbols.', extension: '.svg', icon: '◇' },
    { id: 'css', name: 'CSS classes', description: 'Utility classes for styling icons.', extension: '.css', icon: '#' },
    { id: 'json', name: 'JSON manifest', description: 'Names and metadata for tooling.', extension: '.json', icon: '{ }' },
    { id: 'svg', name: 'Optimized SVG copies', description: 'Copies valid SVG files to the output folder.', extension: '.svg', icon: '▧' },
    { id: 'react', name: 'React components', description: 'JSX components with accessible title support.', extension: '.jsx', icon: '⚛' },
    { id: 'vue', name: 'Vue components', description: 'Single-file components with title support.', extension: '.vue', icon: 'V' },
    { id: 'angular', name: 'Angular components', description: 'Standalone component source templates.', extension: '.ts', icon: 'A' },
    { id: 'font', name: 'Icon font', description: 'Generate TTF, WOFF2 and CSS classes from paths and basic converted shapes.', extension: '.ttf', icon: 'Aa' }
  ];
  private readonly presets: Record<string, string[]> = {
    web: ['sprite', 'css', 'json'],
    react: ['sprite', 'css', 'json', 'react'],
    vue: ['sprite', 'css', 'json', 'vue'],
    angular: ['sprite', 'css', 'json', 'angular'],
    everything: this.formats.map(format => format.id)
  };


  ngOnInit(): void {
    this.projectService.loadConfig().subscribe({
      next: config => {
        this.config.set(config);
        this.selectedFormats.set(new Set(config.defaultFormats));
        this.optimize.set(config.defaultOptimize);
      },
      error: error => this.toast.error(this.message(error))
    });
    this.loadFontPreview();
  }

  setConfig(key: 'projectName' | 'fontFamily' | 'cssPrefix', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.config.update(config => config ? { ...config, [key]: value } : config);
  }

  setConfigBoolean(key: 'defaultOptimize', event: Event): void {
    this.config.update(config => config ? { ...config, [key]: (event.target as HTMLInputElement).checked } : config);
  }

  toggleFormat(id: string): void {
    this.selectedFormats.update(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    this.preset.set('custom');
  }

  applyPreset(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.preset.set(value);
    if (value !== 'custom') {
      this.selectedFormats.set(new Set(this.presets[value] ?? []));
      this.optimize.set(true);
    }
  }

  saveSettings(): void {
    const config = this.config();
    if (!config) return;
    const defaultFormats = this.selectedFormats().size ? [...this.selectedFormats()] : this.projectService.config()?.defaultFormats ?? ['sprite', 'css', 'json'];
    this.saving.set(true);
    this.projectService.updateConfig({ ...config, defaultFormats }).subscribe({
      next: saved => {
        this.config.set(saved);
        this.optimize.set(saved.defaultOptimize);
        document.title = `${saved.projectName} · IconForge Studio`;
        this.toast.success('Project settings saved locally.');
        this.saving.set(false);
      },
      error: error => {
        this.toast.error(this.message(error));
        this.saving.set(false);
      }
    });
  }

  build(): void {
    const config = this.config();
    const formats = [...this.selectedFormats()];
    if (!config || !formats.length) return;
    this.building.set(true);
    this.buildError.set(null);
    this.projectService.build({ formats, optimize: this.optimize(), fontFamily: config.fontFamily, cssPrefix: config.cssPrefix }).subscribe({
      next: () => {
        this.toast.success('Library generated successfully.');
        if (formats.includes('font')) this.loadFontPreview();
        this.building.set(false);
      },
      error: error => {
        const message = this.message(error);
        this.buildError.set(message);
        this.toast.error(message);
        this.building.set(false);
      }
    });
  }

  extension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE';
  }

  glyphCharacter(codepoint: number): string {
    return String.fromCodePoint(codepoint);
  }

  exportZip(): void {
    this.projectService.exportZip().subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'iconforge-export.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.toast.success('ZIP export ready.');
      },
      error: error => this.toast.error(this.message(error))
    });
  }

  fontFamilyCss(): string {
    const family = this.fontPreview()?.family ?? 'IconForge Icons';
    return `"${family.replace(/["\\]/g, '')}"`;
  }

  copyCodepoint(codepoint: number): void {
    const glyph = String.fromCodePoint(codepoint);
    const label = `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
    navigator.clipboard?.writeText(glyph).then(() => this.toast.success(`Copied ${label}.`)).catch(() => this.toast.info(label));
  }

  private loadFontPreview(): void {
    this.projectService.getFontPreview().subscribe({
      next: preview => {
        this.fontPreview.set(preview);
        if (!preview.available || !preview.family || preview.version === undefined) return;
        const styleId = 'iconforge-font-face';
        let style = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!style) {
          style = document.createElement('style');
          style.id = styleId;
          document.head.append(style);
        }
        const family = preview.family.replace(/["\\]/g, '');
        style.textContent = `@font-face{font-family:"${family}";src:url("${environmentFontUrl(preview.version)}") format("woff2");font-display:block}`;
      },
      error: () => this.fontPreview.set({ available: false, icons: [] })
    });
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'The request could not be completed.';
  }
}

function environmentFontUrl(version: number): string {
  return `${environment.apiBaseUrl}/api/font-file/iconforge-icons.woff2?v=${encodeURIComponent(version)}`;
}
