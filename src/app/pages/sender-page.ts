import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { generateKeyText, importKey } from '../core/crypto';
import { RelayClient } from '../core/relay-client';
import { SenderSession, SenderStatus } from '../core/sender-session';
import { Button } from '../ui/button';
import { Alert } from '../ui/alert';

const STATUS_LABEL: Record<SenderStatus, string> = {
  idle: 'Nothing sent yet',
  sending: 'Encrypting and sending…',
  // The relay accepted the latest text; whether a receiver is watching is not known here.
  synced: 'All changes sent',
  retrying: 'Connection problem, retrying…',
};

@Component({
  selector: 'app-sender-page',
  imports: [Alert, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (link(); as link) {
      <div
        class="bg-sky-50 w-full p-4 mb-4 border-sky-100 rounded border flex justify-between items-center gap-4"
      >
        Press the button to copy the link to the message
        <button appButton size="sm" class="mt-2" data-testid="copy-link" (click)="copyLink()">
          {{ copied() ? 'Copied' : 'Copy link' }}
        </button>
      </div>
      @if (copyFailed()) {
        <!-- Fallback when the clipboard is unavailable (e.g. plain HTTP) or access is denied. -->
        <div class="mb-4" data-testid="link-fallback">
          <label class="block text-sm font-medium" for="share-link">
            Copying is not available here. Select the link and copy it manually:
          </label>
          <input
            id="share-link"
            class="mt-1 w-full rounded border border-sky-100 bg-white px-3 py-2 font-mono text-sm"
            readonly
            [value]="link"
            (focus)="$any($event.target).select()"
          />
        </div>
      }
      <div class="rounded-2xl bg-slate-200 p-4">
        <label class="block text-sm font-medium mb-1" for="message">Message</label>
        <textarea
          id="message"
          class="mt-1 h-48 w-full rounded-2xl border border-sky-100 bg-white px-3 py-2 focus:border-slate-300 focus-visible:border-slate-300 focus-visible:outline-none"
          maxlength="4000"
          placeholder="Start typing. The receiver sees it live."
          (input)="onInput($any($event.target).value)"
        ></textarea>
      </div>
      <p class="mt-4 text-sm text-slate-500" role="status" data-testid="status">
        {{ statusLabel[status()] }}
      </p>
    } @else if (error()) {
      <app-alert> Could not create a session. Check your connection and try again. </app-alert>
      <button appButton class="mt-4" [disabled]="creating()" (click)="start()">
        {{ creating() ? 'Trying…' : 'Try again' }}
      </button>
    } @else {
      <p class="text-sm text-slate-500" role="status">Creating a private link…</p>
    }
  `,
})
export class SenderPage {
  private readonly relay = inject(RelayClient);
  private readonly document = inject(DOCUMENT);
  private session: SenderSession | null = null;

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly link = signal<string | null>(null);
  protected readonly status = signal<SenderStatus>('idle');
  protected readonly creating = signal(false);
  protected readonly error = signal(false);
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.session?.close();
      clearTimeout(this.copiedTimer);
    });
    // Arriving here is the decision to send, so the session starts right away.
    void this.start();
  }

  protected async start(): Promise<void> {
    this.creating.set(true);
    this.error.set(false);
    try {
      const created = await this.relay.createSession();
      const keyText = generateKeyText();
      this.session = new SenderSession({
        sessionId: created.sessionId,
        key: await importKey(keyText, 'encrypt'),
        transport: this.relay.senderTransport(created),
        onStatus: (status) => this.status.set(status),
      });
      const origin = this.document.location.origin;
      this.link.set(`${origin}/receive/${created.sessionId}#${keyText}`);
    } catch {
      this.error.set(true);
    } finally {
      this.creating.set(false);
    }
  }

  protected async copyLink(): Promise<void> {
    const link = this.link();
    // The Clipboard API exists only in secure contexts (HTTPS or localhost).
    const clipboard = this.document.defaultView?.navigator.clipboard;
    if (!link) return;
    clearTimeout(this.copiedTimer);
    try {
      if (!clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await clipboard.writeText(link);
    } catch {
      // Unavailable or denied: show the link so it can be copied by hand.
      this.copied.set(false);
      this.copyFailed.set(true);
      return;
    }
    this.copied.set(true);
    this.copiedTimer = setTimeout(() => this.copied.set(false), 6000);
  }

  protected onInput(text: string): void {
    this.session?.setText(text);
  }
}
