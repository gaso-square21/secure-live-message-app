import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { importKey } from '../core/crypto';
import { RelayClient } from '../core/relay-client';
import { ReceiverSession, ReceiverState } from '../core/receiver-session';
import { Alert } from '../ui/alert';
import { ConnectionStatus } from '../ui/connection-status';

@Component({
  selector: 'app-receiver-page',
  imports: [Alert, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (invalidLink()) {
      <app-alert> This link is incomplete or damaged. Ask the sender to share it again. </app-alert>
    } @else if (state(); as state) {
      <app-connection-status data-testid="connection" [status]="state.connection" />

      @if (state.integrityAlert) {
        <app-alert class="mt-3" data-testid="integrity-alert">
          An update could not be verified and was discarded. It was either altered in transit or
          this link has the wrong key.
          @if (state.text !== null) {
            The text below is the last verified version and may be out of date.
          }
        </app-alert>
      }

      @if (state.text !== null) {
        <!-- textContent, never innerHTML: decrypted text is not parsed as HTML. Binding it also
             keeps template whitespace out of the pre, which would otherwise show. -->
        <pre
          class="mt-3 min-h-56 rounded-3xl border border-sky-100 p-4 bg-sky-50 font-sans whitespace-pre-wrap break-words"
          data-testid="message"
          [class.opacity-60]="stale()"
          [textContent]="state.text"
        ></pre>
      } @else if (!state.integrityAlert && state.connection === 'open') {
        <p class="mt-3 text-slate-500">Waiting for the sender to start typing…</p>
      }
    }
  `,
})
export class ReceiverPage {
  protected readonly state = signal<ReceiverState | null>(null);
  protected readonly invalidLink = signal(false);
  /** The shown text may not be current: an update was rejected, or the stream is not live. */
  protected readonly stale = computed(() => {
    const state = this.state();
    return !!state && (state.integrityAlert || state.connection !== 'open');
  });

  constructor() {
    const relay = inject(RelayClient);
    const sessionId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
    // The key lives in the fragment, which the browser never sends to the server.
    const keyText = inject(DOCUMENT).location.hash.slice(1);

    let session: ReceiverSession | null = null;
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      session?.close();
    });

    importKey(keyText, 'decrypt').then(
      (key) => {
        if (destroyed) {
          return;
        }
        session = new ReceiverSession({
          sessionId,
          key,
          transport: relay.receiverTransport(sessionId),
          onState: (state) => this.state.set(state),
        });
        this.state.set(session.snapshot);
      },
      () => this.invalidLink.set(true),
    );
  }
}
