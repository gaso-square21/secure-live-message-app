import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';

/**
 * The app's primary button style, applied to a native `<button>`, or to an `<a>` when the action
 * navigates:
 *
 *   <button appButton size="sm" (click)="copy()">Copy</button>
 *   <a appButton routerLink="/send">Send a message</a>
 *
 * An attribute selector keeps the real element in the caller's template, so `disabled`,
 * `(click)`, links, keyboard focus and accessibility all work natively and nothing has to be
 * forwarded through the component. Layout classes such as margins stay with the caller.
 */
@Component({
  // Attribute selector on purpose, so the native element stays in the caller's template (see above).
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[appButton], a[appButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    // A button inside a form defaults to "submit"; make "button" the default instead.
    // Links get no type attribute: on <a> it means something else.
    '[attr.type]': 'isButton ? type() : null',
    class:
      'inline-block rounded bg-sky-600 px-4 py-2 text-white hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200 ease-in-out',
    '[class.text-sm]': "size() === 'sm'",
  },
})
export class Button {
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly size = input<'sm' | 'md'>('md');

  protected readonly isButton =
    (inject(ElementRef).nativeElement as HTMLElement).tagName === 'BUTTON';
}
