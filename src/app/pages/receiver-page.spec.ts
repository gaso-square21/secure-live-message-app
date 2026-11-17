import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { generateKeyText, importKey, seal } from '../core/crypto';
import { RelayClient } from '../core/relay-client';
import { ReceiverHandlers } from '../core/transport';
import { ReceiverPage } from './receiver-page';

const SESSION = 'session-1';

describe('ReceiverPage', () => {
  let handlers: ReceiverHandlers | null;
  let fixture: ComponentFixture<ReceiverPage>;

  const text = (testId: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`)?.textContent;

  /** Lets the key import and the frame queue finish, then re-renders. */
  const settle = async () => {
    await vi.waitFor(() => expect(handlers).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };

  const open = async (fragment: string) => {
    handlers = null;
    window.location.hash = fragment;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: SESSION }) } },
        },
        {
          provide: RelayClient,
          useValue: {
            receiverTransport: () => ({
              subscribe: (h: ReceiverHandlers) => {
                handlers = h;
                h.onConnection('open');
                return () => undefined;
              },
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ReceiverPage);
    await fixture.whenStable();
  };

  it('renders two consecutive updates', async () => {
    const keyText = generateKeyText();
    const key = await importKey(keyText, 'encrypt');
    await open(keyText);
    await settle();
    expect(text('connection')).toContain('Live');

    handlers!.onFrame(await seal(key, SESSION, 1, 'first'));
    await settle();
    expect(text('message')).toBe('first');

    handlers!.onFrame(await seal(key, SESSION, 2, 'second'));
    await settle();
    expect(text('message')).toBe('second');
  });

  it('never shows the text of a tampered frame', async () => {
    const keyText = generateKeyText();
    const key = await importKey(keyText, 'encrypt');
    await open(keyText);
    await settle();
    handlers!.onFrame(await seal(key, SESSION, 1, 'genuine'));
    await settle();

    const next = await seal(key, SESSION, 2, 'attacker-controlled');
    handlers!.onFrame({ ...next, ct: next.ct.slice(0, -2) + 'AA' });
    await settle();

    expect(text('message')).toBe('genuine');
  });

  it('renders decrypted markup as text, not HTML', async () => {
    const keyText = generateKeyText();
    const key = await importKey(keyText, 'encrypt');
    await open(keyText);
    await settle();

    handlers!.onFrame(await seal(key, SESSION, 1, '<img src=x onerror=alert(1)>'));
    await settle();

    expect(text('message')).toBe('<img src=x onerror=alert(1)>');
    expect((fixture.nativeElement as HTMLElement).querySelector('img')).toBeNull();
  });

  it('reports a damaged link without contacting the relay', async () => {
    await open('not-a-key');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();

    expect(handlers).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('incomplete or damaged');
  });
});
