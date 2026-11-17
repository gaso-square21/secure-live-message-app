import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Connection, ConnectionStatus } from './connection-status';

@Component({
  imports: [ConnectionStatus],
  template: `<app-connection-status class="mt-2" data-testid="connection" [status]="status()" />`,
})
class Host {
  readonly status = signal<Connection>('connecting');
}

describe('ConnectionStatus', () => {
  const setup = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('app-connection-status')!;
    const show = async (status: Connection) => {
      fixture.componentInstance.status.set(status);
      await fixture.whenStable();
    };
    return { badge, show };
  };

  it('is a status region that keeps caller classes and attributes', async () => {
    const { badge } = await setup();
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.getAttribute('data-testid')).toBe('connection');
    expect(badge.classList).toContain('mt-2');
  });

  it.each([
    ['connecting', 'Connecting…', 'bg-slate-100', true],
    ['open', 'Live', 'bg-green-100', true],
    ['lost', 'Connection lost, reconnecting…', 'bg-amber-100', true],
    ['closed', 'Session not found', 'bg-red-100', false],
    ['replaced', 'opened in another tab or device', 'bg-slate-200', false],
  ] as const)('shows %s in words and colour', async (status, label, colour, pulses) => {
    const { badge, show } = await setup();
    await show(status);

    expect(badge.textContent).toContain(label);
    expect(badge.classList).toContain(colour);
    expect(badge.classList).toContain('mt-2');
    expect(badge.getAttribute('data-status')).toBe(status);
    expect(badge.querySelector('.motion-safe\\:animate-ping') !== null).toBe(pulses);
  });

  it('hides the dot from screen readers', async () => {
    const { badge } = await setup();
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
