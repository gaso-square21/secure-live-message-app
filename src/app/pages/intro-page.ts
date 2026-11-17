import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from '../ui/button';

@Component({
  selector: 'app-intro-page',
  imports: [Button, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p>
      Share text with one person and let them watch it change as you type. The text is encrypted in
      your browser; the server only passes on ciphertext and never sees the key.
    </p>

    <section
      class="mt-6 rounded border border-sky-100 p-5 bg-sky-50"
      aria-labelledby="send-heading"
      data-testid="send-box"
    >
      <h2 id="send-heading" class="text-lg font-semibold">Send a message</h2>
      <p class="mt-1 text-sm text-slate-600">
        You get a private link to share. Whoever opens it sees your text live.
      </p>
      <a appButton class="mt-4" routerLink="/send">Send a message</a>
    </section>

    <p class="mt-6 text-sm text-slate-500">Received a link? Just open it to read the message.</p>
  `,
})
export class IntroPage {}
