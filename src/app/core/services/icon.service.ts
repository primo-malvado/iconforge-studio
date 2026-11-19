import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ProjectService } from './project.service';

export interface Icon {
  filename: string;
  name: string;
  content: string;
  viewBox: string;
  error?: string;
}

export interface IconListResponse {
  icons: Icon[];
  count: number;
}

export interface ImportResult {
  imported: number;
  skipped: Array<{ name: string; reason: string }>;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class IconService {
  private readonly iconsState = signal<Icon[]>([]);
  private readonly selectedState = signal<ReadonlySet<string>>(new Set());
  private readonly searchState = signal('');
  private readonly sortState = signal<'name' | 'name-desc'>('name');

  readonly icons = this.iconsState.asReadonly();
  readonly selected = this.selectedState.asReadonly();
  readonly search = this.searchState.asReadonly();
  readonly sort = this.sortState.asReadonly();
  readonly filteredIcons = computed(() => {
    const query = this.searchState().trim().toLocaleLowerCase();
    const sorted = this.iconsState().filter(icon =>
      !query || icon.name.toLocaleLowerCase().includes(query) || icon.filename.toLocaleLowerCase().includes(query)
    );
    return sorted.sort((a, b) => {
      const order = a.name.localeCompare(b.name);
      return this.sortState() === 'name' ? order : -order;
    });
  });

  constructor(private readonly http: HttpClient, private readonly project: ProjectService) {}

  loadIcons(): Observable<IconListResponse> {
    return this.http.get<IconListResponse>(`${environment.apiBaseUrl}/api/icons`).pipe(
      tap(({ icons }) => {
        this.iconsState.set(icons);
        const existing = new Set(icons.map(icon => icon.filename));
        this.selectedState.update(selected => new Set([...selected].filter(filename => existing.has(filename))));
      }),
      tap(() => this.project.refreshHistory().subscribe({ error: () => undefined }))
    );
  }

  setSearch(value: string): void {
    this.searchState.set(value);
  }

  setSort(value: 'name' | 'name-desc'): void {
    this.sortState.set(value);
  }

  toggleSelected(filename: string): void {
    this.selectedState.update(current => {
      const next = new Set(current);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  toggleAllVisible(): void {
    const visible = this.filteredIcons().map(icon => icon.filename);
    const current = this.selectedState();
    const allSelected = visible.length > 0 && visible.every(filename => current.has(filename));
    this.selectedState.update(selected => {
      const next = new Set(selected);
      for (const filename of visible) {
        if (allSelected) next.delete(filename);
        else next.add(filename);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selectedState.set(new Set());
  }

  importFiles(files: Array<{ name: string; content: string }>): Observable<ImportResult> {
    return this.http.post<ImportResult>(`${environment.apiBaseUrl}/api/import`, { files }).pipe(
      switchMap(result => this.loadIcons().pipe(map(() => result)))
    );
  }

  rename(filename: string, name: string): Observable<unknown> {
    return this.http.post(`${environment.apiBaseUrl}/api/rename`, { filename, name }).pipe(
      switchMap(result => this.loadIcons().pipe(map(() => result)))
    );
  }

  deleteSelected(): Observable<{ deleted: string[]; count: number }> {
    return this.http.post<{ deleted: string[]; count: number }>(`${environment.apiBaseUrl}/api/delete`, {
      filenames: [...this.selectedState()]
    }).pipe(
      switchMap(result => {
        this.clearSelection();
        return this.loadIcons().pipe(map(() => result));
      })
    );
  }

  convertSelectedShapes(): Observable<{ convertedIcons: number; convertedShapes: number; unsupported: string[] }> {
    return this.http.post<{ convertedIcons: number; convertedShapes: number; unsupported: string[] }>(
      `${environment.apiBaseUrl}/api/convert-shapes`, { filenames: [...this.selectedState()] }
    ).pipe(
      switchMap(result => {
        this.clearSelection();
        return this.loadIcons().pipe(map(() => result));
      })
    );
  }
}
