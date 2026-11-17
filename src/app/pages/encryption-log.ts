import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { generateKeyText, importKey, open, seal } from '../core/crypto';
import { parseFrame } from '../core/frame';

const MAX_ENTRIES = 20;
const CT_PREVIEW_CHARS = 64;

/** Placeholder session id: nothing here talks to a server. */
const PREVIEW_SESSION = 'local-preview';

export interface LogEntry {
  readonly seq: number;
  readonly plaintext: string;
  readonly iv: string;
  readonly ct: string;
  readonly wireBytes: number;
  readonly ms: number;
  /** The text read back from the wire form, or null if it failed to verify. */
  readonly decrypted: string | null;
}

/**
 * Shows what happens to each edit: it is encrypted, turned into the JSON frame the relay would
 * carry, then read back the way the receiver does (shape check, then authenticated decryption).
 * Runs entirely in this page with its own throwaway key; the key itself is never displayed.
 */
@Component({
  selector: 'app-encryption-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-6" aria-labelledby="log-heading">
      <h2 id="log-heading" class="text-sm font-medium">Encryption log</h2>
      <p class="mt-1 text-xs text-slate-500">
        Local preview with a throwaway key: each edit is encrypted and read back in this page.
        Nothing is sent yet.
      </p>

      @if (entries().length === 0) {
        <p class="mt-2 text-sm text-slate-500">Start typing to see the frames.</p>
      }

      <div class="max-h-[24rem] overflow-y-auto">
        <ol class="mt-2 space-y-2" data-testid="encryption-log">
          @for (entry of entries(); track entry.seq) {
            <li class="rounded border border-sky-100 p-3 text-xs">
              <p class="font-medium">
                #{{ entry.seq }} · {{ entry.plaintext.length }} chars → {{ entry.wireBytes }} bytes
                on the wire · {{ entry.ms.toFixed(1) }} ms
              </p>
              <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt class="text-slate-500">Plaintext</dt>
                <dd class="break-all whitespace-pre-wrap">{{ entry.plaintext }}</dd>
                <dt class="text-slate-500">IV</dt>
                <dd class="font-mono break-all">{{ entry.iv }}</dd>
                <dt class="text-slate-500">Ciphertext</dt>
                <dd class="font-mono break-all">{{ preview(entry.ct) }}</dd>
                <dt class="text-slate-500">Decrypted</dt>
                @if (entry.decrypted !== null) {
                  <dd class="break-all whitespace-pre-wrap text-green-700" data-testid="decrypted">
                    ✓ {{ entry.decrypted }}
                  </dd>
                } @else {
                  <dd class="text-red-700">✗ failed authentication</dd>
                }
              </dl>
            </li>
          }
        </ol>
      </div>
    </section>
  `,
})
export class EncryptionLog {
  protected readonly entries = signal<readonly LogEntry[]>([]);

  private readonly keys = (async () => {
    const keyText = generateKeyText();
    return {
      encrypt: await importKey(keyText, 'encrypt'),
      decrypt: await importKey(keyText, 'decrypt'),
    };
  })();
  private seq = 0;
  /** Edits are processed one at a time, so entries always appear in typing order. */
  private queue: Promise<void> = Promise.resolve();

  add(text: string): void {
    const seq = ++this.seq;
    this.queue = this.queue.then(() => this.process(seq, text));
  }

  /** Resolves once every edit added so far is in the log. */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  protected preview(ct: string): string {
    return ct.length > CT_PREVIEW_CHARS ? `${ct.slice(0, CT_PREVIEW_CHARS)}…` : ct;
  }

  private async process(seq: number, plaintext: string): Promise<void> {
    const keys = await this.keys;
    const start = performance.now();
    const frame = await seal(keys.encrypt, PREVIEW_SESSION, seq, plaintext);
    // The same round trip the real frame makes: JSON over the network, then untrusted input.
    const wire = JSON.stringify(frame);
    let decrypted: string | null;
    try {
      decrypted = await open(keys.decrypt, PREVIEW_SESSION, parseFrame(JSON.parse(wire)));
    } catch {
      decrypted = null;
    }
    const entry: LogEntry = {
      seq,
      plaintext,
      iv: frame.iv,
      ct: frame.ct,
      wireBytes: new TextEncoder().encode(wire).length,
      ms: performance.now() - start,
      decrypted,
    };
    this.entries.update((list) => [entry, ...list].slice(0, MAX_ENTRIES));
  }
}
