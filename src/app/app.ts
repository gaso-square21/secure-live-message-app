import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-2xl p-6">
      <h1 class="text-2xl font-semibold">Secure live message</h1>
      <router-outlet />
    </main>
  `,
})
export class App {}
