import { TestBed } from '@angular/core/testing';
import { SenderPage } from './sender-page';

describe('SenderPage', () => {
  const shownLink = async () => {
    const fixture = TestBed.createComponent(SenderPage);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return root.querySelector('pre')!.textContent!.trim();
  };

  it('shows a receive link with a session id and a 256-bit key in the fragment', async () => {
    const link = new URL(await shownLink());

    expect(link.origin).toBe(document.location.origin);
    // 16-byte session id and 32-byte key, both unpadded base64url.
    expect(link.pathname).toMatch(/^\/receive\/[A-Za-z0-9_-]{22}$/);
    expect(link.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
  });

  it('creates a new session id and key for every page', async () => {
    const first = new URL(await shownLink());
    const second = new URL(await shownLink());

    expect(second.pathname).not.toBe(first.pathname);
    expect(second.hash).not.toBe(first.hash);
  });
});
