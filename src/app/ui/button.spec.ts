import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Button } from './button';

@Component({
  imports: [Button],
  template: `
    <button appButton [size]="size()" [disabled]="disabled()" (click)="clicks = clicks + 1">
      Copy
    </button>
  `,
})
class Host {
  readonly size = signal<'sm' | 'md'>('md');
  readonly disabled = signal(false);
  clicks = 0;
}

@Component({
  imports: [Button],
  template: `<a appButton href="/send" size="sm">Send a message</a>`,
})
class LinkHost {}

describe('Button', () => {
  it('styles a link without turning it into a button', async () => {
    const fixture = TestBed.createComponent(LinkHost);
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a')!;

    expect(link.getAttribute('href')).toBe('/send');
    expect(link.hasAttribute('type')).toBe(false);
    expect(link.classList).toContain('rounded');
    expect(link.classList).toContain('text-sm');
  });

  const setup = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { fixture, host: fixture.componentInstance, button };
  };

  it('renders a native button with the projected label and the shared style', async () => {
    const { button } = await setup();
    expect(button.textContent?.trim()).toBe('Copy');
    expect(button.type).toBe('button');
    expect(button.classList).toContain('rounded');
  });

  it('applies the small size only when asked', async () => {
    const { fixture, host, button } = await setup();
    expect(button.classList).not.toContain('text-sm');

    host.size.set('sm');
    await fixture.whenStable();
    expect(button.classList).toContain('text-sm');
  });

  it('keeps native click and disabled behaviour', async () => {
    const { fixture, host, button } = await setup();
    button.click();
    expect(host.clicks).toBe(1);

    host.disabled.set(true);
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    button.click();
    expect(host.clicks).toBe(1);
  });
});
