import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Alert } from './alert';

@Component({
  imports: [Alert],
  template: `<app-alert class="mt-3" data-testid="box">Something <b>went</b> wrong</app-alert>`,
})
class Host {}

describe('Alert', () => {
  const render = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('app-alert')!;
  };

  it('announces projected content as an alert and keeps caller attributes', async () => {
    const alert = await render();

    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe('Something went wrong');
    expect(alert.querySelector('b')).not.toBeNull();
    expect(alert.classList).toContain('mt-3');
    expect(alert.getAttribute('data-testid')).toBe('box');
  });

  it('shows a warning icon that screen readers skip', async () => {
    const icon = (await render()).querySelector('svg')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
