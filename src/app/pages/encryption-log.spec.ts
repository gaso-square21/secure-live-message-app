import { TestBed } from '@angular/core/testing';
import { EncryptionLog } from './encryption-log';

describe('EncryptionLog', () => {
  const setup = async () => {
    const fixture = TestBed.createComponent(EncryptionLog);
    await fixture.whenStable();
    const log = fixture.componentInstance;
    const items = () => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="encryption-log"] li',
      ),
    ];
    const settle = async () => {
      await log.whenIdle();
      await fixture.whenStable();
    };
    return { log, items, settle };
  };

  it('logs consecutive edits newest first, each read back from its encrypted frame', async () => {
    const { log, items, settle } = await setup();
    log.add('Hello');
    log.add('Hello, world');
    await settle();

    const [newest, oldest] = items();
    expect(items()).toHaveLength(2);
    expect(newest.textContent).toContain('#2');
    expect(newest.querySelector('[data-testid="decrypted"]')?.textContent).toContain(
      'Hello, world',
    );
    expect(oldest.textContent).toContain('#1');
    expect(oldest.querySelector('[data-testid="decrypted"]')?.textContent).toContain('Hello');
  });

  it('shows text as text, never as HTML', async () => {
    const { log, items, settle } = await setup();
    log.add('<img src=x onerror=alert(1)>');
    await settle();

    expect(items()[0].querySelector('img')).toBeNull();
    expect(items()[0].textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps only the most recent entries', async () => {
    const { log, items, settle } = await setup();
    for (let i = 1; i <= 25; i++) {
      log.add(`edit ${i}`);
    }
    await settle();

    expect(items()).toHaveLength(20);
    expect(items()[0].textContent).toContain('#25');
  });
});
