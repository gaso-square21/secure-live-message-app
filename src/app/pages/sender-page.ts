import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toBase64Url } from '../core/base64url';
import { generateKeyText } from '../core/crypto';
import { EncryptionLog } from './encryption-log';

/**
 * Placeholder: the session id is generated locally until the relay server issues it, so the
 * link has its final shape but nobody receives anything yet.
 */
@Component({
  selector: 'app-sender-page',
  imports: [EncryptionLog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-sky-50 w-full p-4 mb-4 border-sky-100 rounded border">
      The link to the message:
      <pre class="overflow-auto w-full text-sm">{{ link }}</pre>
    </div>
    <label class="block text-sm font-medium" for="message">Message</label>
    <textarea
      id="message"
      class="mt-1 h-48 w-full rounded border border-sky-100 px-3 py-2 focus:border-sky-500 focus-visible:border-sky-500 focus-visible:outline-none"
      maxlength="4000"
      placeholder="Start typing. The receiver sees it live."
      (input)="log.add($any($event.target).value)"
    ></textarea>
    <p class="mt-1 text-sm text-slate-500" role="status" data-testid="status">Not connected</p>
    <app-encryption-log #log />
  `,
})
export class SenderPage {
  private readonly sessionId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  protected readonly link = `${inject(DOCUMENT).location.origin}/receive/${this.sessionId}#${generateKeyText()}`;
}
