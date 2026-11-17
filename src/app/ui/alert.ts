import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Error box for problems the user must notice:
 *
 *   <app-alert class="mt-3">The link is damaged.</app-alert>
 *
 * The `alert` role is built in, so assistive technology announces every alert and no caller can
 * forget it. Layout classes such as margins stay with the caller.
 */
@Component({
  selector: 'app-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Warning triangle; decorative, the text carries the meaning. -->
    <svg
      class="mt-0.5 size-6 shrink-0 text-red-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
      />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
    <div class="min-w-0"><ng-content /></div>
  `,
  host: {
    role: 'alert',
    class:
      'flex items-center gap-4 rounded-md bg-red-100 px-4 py-3 text-slate-700 border border-red-300',
  },
})
export class Alert {}
