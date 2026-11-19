import { Component, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ToastMessage, ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      <div *ngFor="let toast of toasts(); trackBy: trackToast" class="toast show"
           [class.error]="toast.type === 'error'" [class.warning]="toast.type === 'warning'" role="status">
        {{ toast.message }}
        <button type="button" class="toast-close" aria-label="Dismiss notification" (click)="remove(toast.id)">×</button>
      </div>
    </div>
  `
})
export class ToastComponent implements OnDestroy {
  readonly toasts = signal<ToastMessage[]>([]);
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly destroyRef = inject(DestroyRef);

  constructor(toastService: ToastService) {
    toastService.messages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(message => {
      this.toasts.update(items => [...items, message]);
      if (message.duration > 0) {
        this.timers.set(message.id, setTimeout(() => this.remove(message.id), message.duration));
      }
    });
  }

  trackToast(_index: number, toast: ToastMessage): number {
    return toast.id;
  }

  remove(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
    this.toasts.update(items => items.filter(item => item.id !== id));
  }

  ngOnDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
