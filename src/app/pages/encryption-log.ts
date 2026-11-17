import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Frame } from '../core/frame';
import { SenderTransport } from '../core/transport';

const CT_PREVIEW_CHARS = 64;

export interface LogEntry {
  readonly seq: number;
  readonly iv: string;
  readonly ct: string;
  /** Size of the JSON body sent to the relay. */
  readonly wireBytes: number;
  /** Time from starting the request to the relay's answer. */
  readonly ms: number;
  readonly outcome: 'sent' | 'failed';
}

/**
 * Wraps a sender transport so every frame and its outcome are reported, without changing what is
 * sent or how failures propagate.
 */
export function withFrameLog(
  transport: SenderTransport,
  onEntry: (entry: LogEntry) => void,
): SenderTransport {
  return {
    async send(frame: Frame): Promise<void> {
      const start = performance.now();
      const report = (outcome: LogEntry['outcome']) =>
        onEntry({
          seq: frame.seq,
          iv: frame.iv,
          ct: frame.ct,
          wireBytes: new TextEncoder().encode(JSON.stringify(frame)).length,
          ms: performance.now() - start,
          outcome,
        });
      try {
        await transport.send(frame);
      } catch (error) {
        report('failed');
        throw error;
      }
      report('sent');
    },
  };
}

/**
 * Development aid: lists the frames the sender handed to the relay, newest first. This is
 * everything the server receives: a sequence number, an IV and ciphertext, never the text or the
 * key.
 *
 * Not used by any page, so it is not part of the build. To show it on the sender page, wrap the
 * transport and render the entries:
 *
 *   transport: withFrameLog(this.relay.senderTransport(created), (entry) =>
 *     this.log.update((list) => [entry, ...list].slice(0, 20)),
 *   ),
 *
 *   <app-encryption-log [entries]="log()" />
 */
@Component({
  selector: 'app-encryption-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-6" aria-labelledby="log-heading">
      <h2 id="log-heading" class="text-sm font-medium">Encryption log</h2>
      <p class="mt-1 text-xs text-slate-500">
        Every frame sent to the server. This is all it sees: never the text or the key. Fast typing
        is batched, so there are fewer frames than keystrokes.
      </p>

      @if (entries().length === 0) {
        <p class="mt-2 text-sm text-slate-500">Start typing to see the frames.</p>
      }

      <div class="max-h-[24rem] overflow-y-auto">
        <ol class="mt-2 space-y-2" data-testid="encryption-log">
          @for (entry of entries(); track entry.seq) {
            <li class="rounded border border-sky-100 p-3 text-xs">
              <p class="font-medium">
                #{{ entry.seq }} · {{ entry.wireBytes }} bytes ·
                @if (entry.outcome === 'sent') {
                  <span class="text-green-700">sent in {{ entry.ms.toFixed(0) }} ms</span>
                } @else {
                  <span class="text-red-700">failed, will retry</span>
                }
              </p>
              <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt class="text-slate-500">IV</dt>
                <dd class="font-mono break-all">{{ entry.iv }}</dd>
                <dt class="text-slate-500">Ciphertext</dt>
                <dd class="font-mono break-all">{{ preview(entry.ct) }}</dd>
              </dl>
            </li>
          }
        </ol>
      </div>
    </section>
  `,
})
export class EncryptionLog {
  readonly entries = input.required<readonly LogEntry[]>();

  protected preview(ct: string): string {
    return ct.length > CT_PREVIEW_CHARS ? `${ct.slice(0, CT_PREVIEW_CHARS)}…` : ct;
  }
}
