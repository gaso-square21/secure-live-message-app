import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReceiverState } from '../core/receiver-session';

export type Connection = ReceiverState['connection'];

interface Look {
  readonly label: string;
  /** Colours of the badge. */
  readonly badge: string;
  /** Colour of the dot. */
  readonly dot: string;
  /** Pulse the dot: the connection is active or being re-established. */
  readonly pulse: boolean;
}

const LOOK: Record<Connection, Look> = {
  connecting: {
    label: 'Connecting…',
    badge: 'bg-slate-100 text-slate-700',
    dot: 'bg-slate-400',
    pulse: true,
  },
  open: { label: 'Live', badge: 'bg-green-100 text-green-800', dot: 'bg-green-500', pulse: true },
  lost: {
    label: 'Connection lost, reconnecting…',
    badge: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
    pulse: true,
  },
  closed: {
    label: 'Session not found. It may have ended, or the link is wrong.',
    badge: 'bg-red-100 text-red-800',
    dot: 'bg-red-500',
    pulse: false,
  },
  replaced: {
    label: 'This session was opened in another tab or device.',
    badge: 'bg-slate-200 text-slate-700',
    dot: 'bg-slate-500',
    pulse: false,
  },
};

/**
 * Coloured badge for the receiver's connection:
 *
 *   <app-connection-status [status]="state.connection" />
 *
 * Green while live, amber while reconnecting, red when the session is gone. Colour is never the
 * only signal: the label always says the same in words. The `status` role makes screen readers
 * announce changes politely.
 */
@Component({
  selector: 'app-connection-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="relative mt-1.5 flex size-2 shrink-0" aria-hidden="true">
      @if (look().pulse) {
        <span
          class="absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping"
          [class]="look().dot"
        ></span>
      }
      <span class="relative inline-flex size-2 rounded-full" [class]="look().dot"></span>
    </span>
    <span>{{ look().label }}</span>
  `,
  host: {
    role: 'status',
    class: 'inline-flex items-start gap-2 rounded-2xl px-3 py-1 text-sm font-medium',
    '[class]': 'look().badge',
    '[attr.data-status]': 'status()',
  },
})
export class ConnectionStatus {
  readonly status = input.required<Connection>();

  protected readonly look = computed(() => LOOK[this.status()]);
}
