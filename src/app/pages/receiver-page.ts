import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Placeholder: connecting to the session and decrypting are added in later steps. */
@Component({
  selector: 'app-receiver-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="text-sm text-slate-600" role="status" data-testid="connection">Not connected</p>
    <p class="mt-3 text-slate-500">Waiting for the sender to start typing…</p>
  `,
})
export class ReceiverPage {}
