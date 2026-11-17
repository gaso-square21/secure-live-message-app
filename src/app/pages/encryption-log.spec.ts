import { TestBed } from '@angular/core/testing';
import { Frame } from '../core/frame';
import { EncryptionLog, LogEntry, withFrameLog } from './encryption-log';

const frame: Frame = { v: 1, seq: 7, iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVydGV4dA' };

const entry = (seq: number, outcome: LogEntry['outcome'], ct = 'Y2lwaGVydGV4dA'): LogEntry => ({
  seq,
  iv: 'AAAAAAAAAAAAAAAA',
  ct,
  wireBytes: 60,
  ms: 12,
  outcome,
});

describe('withFrameLog', () => {
  it('passes the frame on unchanged and reports it as sent', async () => {
    const sent: Frame[] = [];
    const entries: LogEntry[] = [];
    const transport = withFrameLog({ send: async (f) => void sent.push(f) }, (e) =>
      entries.push(e),
    );

    await transport.send(frame);

    expect(sent).toEqual([frame]);
    expect(entries).toEqual([
      expect.objectContaining({ seq: 7, iv: frame.iv, ct: frame.ct, outcome: 'sent' }),
    ]);
    expect(entries[0].wireBytes).toBe(JSON.stringify(frame).length);
  });

  it('reports a failed send and still rejects, so the session retries', async () => {
    const entries: LogEntry[] = [];
    const transport = withFrameLog(
      {
        send: async () => {
          throw new Error('offline');
        },
      },
      (e) => entries.push(e),
    );

    await expect(transport.send(frame)).rejects.toThrow('offline');
    expect(entries.map((e) => e.outcome)).toEqual(['failed']);
  });
});

describe('EncryptionLog', () => {
  const render = async (entries: LogEntry[]) => {
    const fixture = TestBed.createComponent(EncryptionLog);
    fixture.componentRef.setInput('entries', entries);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return { root, items: [...root.querySelectorAll('[data-testid="encryption-log"] li')] };
  };

  it('invites typing while nothing has been sent', async () => {
    const { root, items } = await render([]);
    expect(items).toHaveLength(0);
    expect(root.textContent).toContain('Start typing');
  });

  it('shows each frame with its outcome, in the given order', async () => {
    const { items } = await render([entry(2, 'failed'), entry(1, 'sent')]);

    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('#2');
    expect(items[0].textContent).toContain('failed, will retry');
    expect(items[1].textContent).toContain('#1');
    expect(items[1].textContent).toContain('sent in 12 ms');
    expect(items[1].textContent).toContain('AAAAAAAAAAAAAAAA');
  });

  it('shortens long ciphertext', async () => {
    const { items } = await render([entry(1, 'sent', 'A'.repeat(200))]);
    expect(items[0].textContent).toContain(`${'A'.repeat(64)}…`);
    expect(items[0].textContent).not.toContain('A'.repeat(65));
  });
});
