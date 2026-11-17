import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Frame } from '../core/frame';
import { CreatedSession, RelayClient } from '../core/relay-client';
import { SenderPage } from './sender-page';

const SESSION: CreatedSession = { sessionId: 'session-1', writeToken: 'write-token' };

describe('SenderPage', () => {
  let fixture: ComponentFixture<SenderPage>;
  let sent: Frame[];
  let createSession: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => root().querySelector(`[data-testid="${id}"]`);

  const setClipboard = (clipboard: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });

  /** Lets pending promises finish, then re-renders. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };

  const render = async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RelayClient,
          useValue: {
            createSession,
            senderTransport: () => ({
              send: async (frame: Frame) => {
                sent.push(frame);
              },
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SenderPage);
    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    await settle();
  };

  const clickCopy = async () => {
    (byTestId('copy-link') as HTMLButtonElement).click();
    await settle();
  };

  /** The share link, as the Copy button hands it to the clipboard. */
  const copiedLink = async () => {
    await clickCopy();
    return new URL(writeText.mock.calls.at(-1)![0] as string);
  };

  beforeEach(() => {
    sent = [];
    createSession = vi.fn().mockResolvedValue(SESSION);
    writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
  });

  afterEach(() => setClipboard(undefined));

  it('copies a link to the server-issued session with a 256-bit key in the fragment', async () => {
    await render();
    const link = await copiedLink();

    expect(link.origin).toBe(document.location.origin);
    expect(link.pathname).toBe('/receive/session-1');
    expect(link.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
    expect(byTestId('copy-link')?.textContent).toContain('Copied');
    expect(byTestId('link-fallback')).toBeNull();
  });

  it('sends typed text to the relay encrypted', async () => {
    await render();
    const keyText = (await copiedLink()).hash.slice(1);

    const textarea = root().querySelector('textarea')!;
    textarea.value = 'the launch code is 0000';
    textarea.dispatchEvent(new Event('input'));
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(byTestId('status')?.textContent).toContain('All changes sent');
    });

    expect(sent).toHaveLength(1);
    const seenByRelay = JSON.stringify(sent);
    expect(seenByRelay).not.toContain('launch code');
    expect(seenByRelay).not.toContain(keyText);
  });

  it.each([
    ['is denied', () => writeText.mockRejectedValue(new Error('denied'))],
    ['is unavailable', () => setClipboard(undefined)],
  ])('shows the link for manual copying when the clipboard %s', async (_case, breakClipboard) => {
    await render();
    breakClipboard();
    await clickCopy();

    const field = byTestId('link-fallback')?.querySelector('input');
    expect(field?.value).toMatch(/\/receive\/session-1#[A-Za-z0-9_-]{43}$/);
    expect(field?.readOnly).toBe(true);
    expect(byTestId('copy-link')?.textContent).toContain('Copy link');
  });

  it('clears the "Copied" timer when the page closes', async () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await render();
    await clickCopy();
    const call = setSpy.mock.calls.findIndex(([, ms]) => ms === 6000);
    const timer = setSpy.mock.results[call].value;

    fixture.destroy();

    expect(clearSpy).toHaveBeenCalledWith(timer);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('offers to try again when the session cannot be created', async () => {
    createSession.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Could not create');

    root().querySelector('button')!.click();
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    await settle();
    expect(byTestId('copy-link')).not.toBeNull();
  });
});
