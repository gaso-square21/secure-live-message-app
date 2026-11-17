import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Placeholder: the session, the share link and encryption are added in later steps. */
@Component({
  selector: 'app-sender-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-sky-50 w-full p-4 mb-4 border-sky-100 rounded border">
      The link to the message comes here, for now just a placeholder
    </div>
    <label class="block text-sm font-medium" for="message">Message</label>
    <textarea
      id="message"
      class="mt-1 h-48 w-full rounded border border-sky-100 px-3 py-2 focus:border-sky-500 focus-visible:border-sky-500 focus-visible:outline-none"
      maxlength="4000"
      placeholder="Start typing. The receiver sees it live."
    ></textarea>
    <p class="mt-1 text-sm text-slate-500" role="status" data-testid="status">Not connected</p>
  `,
})
export class SenderPage {}
