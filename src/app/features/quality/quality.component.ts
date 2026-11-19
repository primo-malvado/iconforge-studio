import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconService } from '../../core/services/icon.service';
import { IconComparison, ProjectService, QualityReport } from '../../core/services/project.service';
import { ToastService } from '../../core/services/toast.service';
import { SafeHtmlPipe } from '../../shared/pipes/safe-html.pipe';
import { safeSvgPreview } from '../../shared/utils/svg-preview';

@Component({
  selector: 'app-quality',
  standalone: true,
  imports: [CommonModule, SafeHtmlPipe],
  template: `
    <section class="view active">
      <div class="page-heading"><div><div class="eyebrow">HEALTH & RELIABILITY</div><h1>Quality Center</h1><p>Catch problems before your icons reach production.</p></div><button class="btn btn-secondary" type="button" [disabled]="checking()" (click)="runChecks()">{{ checking() ? 'Checking…' : '↻ Run checks' }}</button></div>
      <div class="quality-banner"><div class="quality-mark">{{ headlineIcon() }}</div><div><strong>{{ headline() }}</strong><p>{{ subhead() }}</p></div></div>
      <div class="quality-cards"><article *ngFor="let card of cards()" class="quality-card"><span>{{ card.title }}</span><strong>{{ card.value }}</strong><small>{{ card.description }}</small></article></div>
      <article class="panel quality-details">
        <div class="panel-title"><div><h2>Findings</h2><p>Issues and recommendations from the latest scan.</p></div></div>
        <div class="findings-list" *ngIf="report(); else noScan">
          <div *ngFor="let finding of report()!.findings" class="finding"><span class="finding-symbol" [class.finding-error]="finding.severity === 'error'">{{ finding.severity === 'error' ? '!' : finding.severity === 'warning' ? '⚠' : 'i' }}</span><div><strong>{{ finding.name || finding.filename }} · {{ finding.severity }}</strong><p>{{ finding.message }}</p></div></div>
          <div *ngIf="report()!.findings.length === 0" class="empty-state small"><div class="empty-icon">✓</div><strong>No quality findings</strong><p>All icons passed the current advisory checks.</p></div>
        </div>
        <ng-template #noScan><div class="empty-state small"><strong>No scan run yet</strong><p>Run checks to inspect your current collection.</p></div></ng-template>
      </article>
      <article class="panel compare-panel">
        <div class="panel-title"><div><h2>Visual optimization comparison</h2><p>Compare a source SVG with its optimized result and inspect the file-size difference.</p></div></div>
        <div class="compare-controls"><select aria-label="Icon to compare" [value]="compareFilename()" (change)="compareFilename.set($any($event.target).value)"><option value="">Select an icon</option><option *ngFor="let icon of validIcons()" [value]="icon.filename">{{ icon.name }}</option></select><button class="btn btn-secondary" type="button" [disabled]="comparing() || !compareFilename()" (click)="compare()">{{ comparing() ? 'Comparing…' : 'Compare original and optimized' }}</button></div>
        <div *ngIf="comparison() as result" class="compare-content">
          <div class="compare-summary"><strong>{{ result.filename }}</strong>: {{ result.originalBytes | number }} bytes original → {{ result.optimizedBytes | number }} bytes optimized. {{ savedDescription(result) }}. Optimizer: {{ result.optimizer }}.</div>
          <div class="compare-grid"><article class="compare-side"><h3>Original SVG</h3><div class="compare-art" [innerHTML]="safeSvgPreview(result.original) | safeHtml"></div><div class="compare-size">Source · <strong>{{ result.originalBytes | number }} B</strong></div></article><article class="compare-side"><h3>Optimized SVG</h3><div class="compare-art" [innerHTML]="safeSvgPreview(result.optimized) | safeHtml"></div><div class="compare-size">Result · <strong>{{ result.optimizedBytes | number }} B</strong></div></article></div>
        </div>
      </article>
      <p class="footnote">Checks cover basic SVG structure, scaling hints and accessibility metadata. They are advisory, not a complete accessibility, visual-regression or security audit.</p>
    </section>
  `
})
export class QualityComponent {
  readonly report = signal<QualityReport | null>(null);
  readonly checking = signal(false);
  readonly compareFilename = signal('');
  readonly comparison = signal<IconComparison | null>(null);
  readonly comparing = signal(false);
  readonly validIcons = computed(() => this.iconService.icons().filter(icon => !icon.error));
  readonly cards = computed(() => {
    const icons = this.iconService.icons();
    const invalid = icons.filter(icon => !!icon.error).length;
    return [
      { title: 'Total icons', value: icons.length, description: 'SVG files in workspace' },
      { title: 'Valid SVGs', value: icons.length - invalid, description: 'Passed basic validation' },
      { title: 'Issues', value: this.report()?.summary.errors ?? invalid, description: 'Invalid or flagged files' }
    ];
  });
  readonly headline = computed(() => {
    const icons = this.iconService.icons();
    if (!icons.length) return 'Ready to inspect your collection';
    if (this.report()) {
      const summary = this.report()!.summary;
      return summary.errors ? `${summary.errors} issue(s) need attention` : 'Your collection looks healthy';
    }
    return icons.some(icon => icon.error) ? 'Some icons need attention' : 'Ready to run quality checks';
  });
  readonly headlineIcon = computed(() => this.report()?.summary.errors ? '!' : this.iconService.icons().some(icon => !!icon.error) ? '!' : '✓');
  readonly subhead = computed(() => {
    const current = this.report();
    if (current) return `${current.summary.errors} errors, ${current.summary.warnings} warnings and ${current.summary.info} recommendations across ${current.count} icons.`;
    if (!this.iconService.icons().length) return 'Import SVG files, then run checks to validate structure and flag suspicious files.';
    return 'Run checks to validate SVG structure and flag suspicious files.';
  });

  constructor(private readonly iconService: IconService, private readonly projectService: ProjectService, private readonly toast: ToastService) {}

  runChecks(): void {
    this.checking.set(true);
    this.projectService.getQualityReport().subscribe({
      next: report => {
        this.report.set(report);
        this.checking.set(false);
        this.toast.success('SVG quality checks completed.');
      },
      error: error => {
        this.checking.set(false);
        this.toast.error(error instanceof Error ? error.message : 'Could not run quality checks.');
      }
    });
  }

  compare(): void {
    const filename = this.compareFilename();
    if (!filename) return;
    this.comparing.set(true);
    this.projectService.compareIcon(filename).subscribe({
      next: comparison => {
        this.comparison.set(comparison);
        this.comparing.set(false);
      },
      error: error => {
        this.comparing.set(false);
        this.toast.error(error instanceof Error ? error.message : 'Could not compare this icon.');
      }
    });
  }

  savedDescription(result: IconComparison): string {
    return result.bytesSaved >= 0
      ? `${result.bytesSaved} bytes (${result.percentSaved}% smaller)`
      : `${Math.abs(result.bytesSaved)} bytes larger (${Math.abs(result.percentSaved)}% increase)`;
  }

  safeSvgPreview(svg: string): string {
    return safeSvgPreview(svg);
  }
}
