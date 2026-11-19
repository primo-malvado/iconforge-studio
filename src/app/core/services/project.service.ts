import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ProjectConfig {
  projectName: string;
  fontFamily: string;
  cssPrefix: string;
  defaultOptimize: boolean;
  defaultFormats: string[];
}

export interface BuildResult {
  iconCount: number;
  optimizer: string;
  outputDirectory: string;
  generated: string[];
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  persistent?: boolean;
  storage?: string;
}

export interface QualityReport {
  count: number;
  findings: Array<{ filename: string; name: string; severity: 'error' | 'warning' | 'info'; message: string; [key: string]: unknown }>;
  summary: { errors: number; warnings: number; info: number };
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly configState = signal<ProjectConfig | null>(null);
  private readonly buildResultState = signal<BuildResult | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly historyState = signal<HistoryState>({ canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 });

  readonly config = this.configState.asReadonly();
  readonly buildResult = this.buildResultState.asReadonly();
  readonly isLoading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly history = this.historyState.asReadonly();
  readonly isConfigValid = computed(() => this.configState() !== null);

  constructor(private readonly http: HttpClient) {}

  loadConfig(): Observable<ProjectConfig> {
    this.loadingState.set(true);
    this.errorState.set(null);
    return this.http.get<ProjectConfig>(`${environment.apiBaseUrl}/api/project`).pipe(
      tap(config => this.configState.set(config)),
      finalize(() => this.loadingState.set(false))
    );
  }

  updateConfig(config: Partial<ProjectConfig>): Observable<ProjectConfig> {
    return this.http.post<ProjectConfig>(`${environment.apiBaseUrl}/api/project`, config).pipe(
      tap(saved => this.configState.set(saved))
    );
  }

  build(payload: { formats: string[]; optimize: boolean; fontFamily: string; cssPrefix: string }): Observable<BuildResult> {
    return this.http.post<BuildResult>(`${environment.apiBaseUrl}/api/build`, payload).pipe(
      tap(result => this.buildResultState.set(result))
    );
  }

  getHistory(): Observable<HistoryState> {
    return this.http.get<HistoryState>(`${environment.apiBaseUrl}/api/history`);
  }

  refreshHistory(): Observable<HistoryState> {
    return this.getHistory().pipe(tap(state => this.historyState.set(state)));
  }

  undo(): Observable<{ action: string }> {
    return this.http.post<{ action: string }>(`${environment.apiBaseUrl}/api/undo`, {}).pipe(
      tap(() => this.loadConfig().subscribe())
    );
  }

  redo(): Observable<{ action: string }> {
    return this.http.post<{ action: string }>(`${environment.apiBaseUrl}/api/redo`, {}).pipe(
      tap(() => this.loadConfig().subscribe())
    );
  }

  getQualityReport(): Observable<QualityReport> {
    return this.http.get<QualityReport>(`${environment.apiBaseUrl}/api/quality`);
  }

  exportZip(): Observable<Blob> {
    return this.http.get(`${environment.apiBaseUrl}/api/export.zip`, { responseType: 'blob' });
  }

  getFontPreview(): Observable<FontPreview> {
    return this.http.get<FontPreview>(`${environment.apiBaseUrl}/api/font-preview`);
  }

  compareIcon(filename: string): Observable<IconComparison> {
    return this.http.post<IconComparison>(`${environment.apiBaseUrl}/api/compare`, { filename });
  }
}

export interface FontPreview {
  available: boolean;
  family?: string;
  version?: number;
  icons: Array<{ name: string; codepoint: number; hex: string }>;
}

export interface IconComparison {
  filename: string;
  original: string;
  optimized: string;
  originalBytes: number;
  optimizedBytes: number;
  bytesSaved: number;
  percentSaved: number;
  optimizer: string;
}
