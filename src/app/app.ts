import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

const DEFAULT_HEADING = 'Secure live message';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-screen items-start justify-center sm:pt-16 p-4' },
  template: `
    <main class="w-full max-w-2xl rounded bg-white p-6">
      <h1 class="mb-4 text-2xl font-semibold">{{ heading() }}</h1>
      <router-outlet />
    </main>
  `,
})
export class App {
  private readonly router = inject(Router);

  /** Mirrors the active route's title, so the heading and the browser tab always agree. */
  protected readonly heading = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.routerState.snapshot.root.firstChild?.title ?? DEFAULT_HEADING),
    ),
    { initialValue: DEFAULT_HEADING },
  );
}
