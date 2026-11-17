import { generateKeyText, importKey, seal } from './crypto';
import { Frame } from './frame';
import { ReceiverSession, ReceiverState } from './receiver-session';
import { SenderSession, SenderStatus } from './sender-session';
import { ReceiverHandlers, ReceiverTransport, SenderTransport } from './transport';

/**
 * In-memory stand-in for the relay server. Like the real one it keeps only the latest frame
 * and hands it to a receiver that connects late. Hooks let a test play a hostile or slow relay.
 */
class FakeRelay implements SenderTransport, ReceiverTransport {
  readonly sent: Frame[] = [];
  /** Transforms a frame on its way to the receiver. */
  tamper: (frame: Frame) => unknown = (frame) => frame;
  /** When set, `send` waits for this promise before completing. */
  gate: Promise<void> | null = null;
  failNextSends = 0;

  private latest: Frame | null = null;
  private handlers: ReceiverHandlers | null = null;

  /** When each accepted send arrived, in milliseconds. */
  readonly sentAt: number[] = [];

  async send(frame: Frame): Promise<void> {
    if (this.failNextSends > 0) {
      this.failNextSends--;
      throw new Error('network down');
    }
    await this.gate;
    this.sent.push(frame);
    this.sentAt.push(performance.now());
    this.latest = frame;
    // Serialise like the network would, so nothing is shared by reference.
    this.deliver(frame);
  }

  subscribe(handlers: ReceiverHandlers): () => void {
    this.handlers = handlers;
    handlers.onConnection('open');
    if (this.latest) {
      this.deliver(this.latest);
    }
    return () => (this.handlers = null);
  }

  /** Pushes arbitrary data to the receiver, as a compromised relay could. */
  inject(raw: unknown): void {
    this.handlers?.onFrame(raw);
  }

  private deliver(frame: Frame): void {
    this.handlers?.onFrame(JSON.parse(JSON.stringify(this.tamper(frame))));
  }
}

const SESSION = 'session-1';

async function setup(options: { connectReceiver?: boolean; minIntervalMs?: number } = {}) {
  const relay = new FakeRelay();
  const keyText = generateKeyText();
  const statuses: SenderStatus[] = [];
  const sender = new SenderSession({
    sessionId: SESSION,
    key: await importKey(keyText, 'encrypt'),
    transport: relay,
    onStatus: (status) => statuses.push(status),
    retryDelayMs: 0,
    // Most tests are about ordering, not timing; the throttle has its own tests below.
    minIntervalMs: options.minIntervalMs ?? 0,
  });
  const states: ReceiverState[] = [];
  const connect = async (receiverKeyText = keyText, sessionId = SESSION) =>
    new ReceiverSession({
      sessionId,
      key: await importKey(receiverKeyText, 'decrypt'),
      transport: relay,
      onState: (state) => states.push(state),
    });
  const receiver = options.connectReceiver === false ? null : await connect();
  /** Texts the receiver showed, in order, without repeats caused by unrelated state changes. */
  const shownTexts = () =>
    states.map((s) => s.text).filter((text, i, all) => text !== null && text !== all[i - 1]);
  return { relay, keyText, sender, receiver: receiver!, connect, states, statuses, shownTexts };
}

describe('sender to receiver flow', () => {
  it('delivers consecutive updates in order', async () => {
    const { sender, receiver, shownTexts } = await setup();

    for (const text of ['Hello', 'Hello, world', 'Hello, world!']) {
      sender.setText(text);
      await sender.whenIdle();
      await receiver.whenSettled();
      expect(receiver.snapshot.text).toBe(text);
    }

    expect(shownTexts()).toEqual(['Hello', 'Hello, world', 'Hello, world!']);
    expect(receiver.snapshot).toMatchObject({ seq: 3, integrityAlert: false, rejected: 0 });
  });

  it('never hands the relay anything containing the plaintext or the key', async () => {
    const { sender, relay, keyText } = await setup();
    sender.setText('the launch code is 0000');
    await sender.whenIdle();

    const seenByRelay = JSON.stringify(relay.sent);
    expect(seenByRelay).not.toContain('launch code');
    expect(seenByRelay).not.toContain(keyText);
    expect(Object.keys(relay.sent[0]).sort()).toEqual(['ct', 'iv', 'seq', 'v']);
  });

  it('shows the current text to a receiver that connects late', async () => {
    const { sender, connect } = await setup({ connectReceiver: false });
    sender.setText('first');
    sender.setText('second');
    await sender.whenIdle();

    const receiver = await connect();
    await receiver.whenSettled();
    expect(receiver.snapshot.text).toBe('second');
  });

  it('shows an empty string when the sender clears the text', async () => {
    const { sender, receiver } = await setup();
    sender.setText('something');
    sender.setText('');
    await sender.whenIdle();
    await receiver.whenSettled();
    expect(receiver.snapshot.text).toBe('');
  });
});

describe('sender concurrency', () => {
  it('collapses edits made during an in-flight send into one follow-up frame', async () => {
    const { sender, receiver, relay } = await setup();
    let release!: () => void;
    relay.gate = new Promise((resolve) => (release = resolve));

    sender.setText('a');
    sender.setText('ab');
    sender.setText('abc');
    sender.setText('abcd');
    relay.gate = null;
    release();
    await sender.whenIdle();
    await receiver.whenSettled();

    expect(relay.sent.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(receiver.snapshot.text).toBe('abcd');
  });

  it('emits strictly increasing sequence numbers', async () => {
    const { sender, relay } = await setup();
    for (let i = 0; i < 20; i++) {
      sender.setText(`text ${i}`);
      if (i % 3 === 0) {
        await sender.whenIdle();
      }
    }
    await sender.whenIdle();

    const seqs = relay.sent.map((frame) => frame.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('retries after a failed send and delivers the newest text', async () => {
    const { sender, receiver, relay, statuses } = await setup();
    relay.failNextSends = 2;

    sender.setText('draft');
    sender.setText('final');
    await sender.whenIdle();
    await receiver.whenSettled();

    expect(statuses).toContain('retrying');
    expect(statuses.at(-1)).toBe('synced');
    expect(receiver.snapshot.text).toBe('final');
  });

  it('stops sending after close', async () => {
    const { sender, relay } = await setup();
    sender.setText('before');
    await sender.whenIdle();
    sender.close();
    sender.setText('after');
    await sender.whenIdle();
    expect(relay.sent).toHaveLength(1);
  });
});

describe('sender throttle', () => {
  const INTERVAL = 100;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('sends the first edit at once, then at most one frame per interval, ending on the latest', async () => {
    const { sender, receiver, relay } = await setup({ minIntervalMs: INTERVAL });

    // Twenty keystrokes 10 ms apart: 200 ms of fast typing.
    let text = '';
    for (let i = 0; i < 20; i++) {
      text += 'x';
      sender.setText(text);
      await pause(10);
    }
    await sender.whenIdle();
    await receiver.whenSettled();

    expect(relay.sent.length).toBeGreaterThanOrEqual(2);
    expect(relay.sent.length).toBeLessThanOrEqual(5);
    expect(receiver.snapshot.text).toBe('x'.repeat(20));
    const gaps = relay.sentAt.slice(1).map((at, i) => at - relay.sentAt[i]);
    // Small tolerance for timer jitter.
    gaps.forEach((gap) => expect(gap).toBeGreaterThanOrEqual(INTERVAL - 5));
  });

  it('does not delay a single edit after a quiet period', async () => {
    const { sender, relay } = await setup({ minIntervalMs: INTERVAL });
    sender.setText('first');
    await sender.whenIdle();
    await pause(INTERVAL + 20);

    const start = performance.now();
    sender.setText('second');
    await sender.whenIdle();
    expect(performance.now() - start).toBeLessThan(INTERVAL / 2);
    expect(relay.sent).toHaveLength(2);
  });

  it('drops a throttled edit when the session is closed', async () => {
    const { sender, relay } = await setup({ minIntervalMs: INTERVAL });
    sender.setText('sent');
    await sender.whenIdle();
    sender.setText('waiting for the interval');
    sender.close();
    await pause(INTERVAL + 20);
    expect(relay.sent).toHaveLength(1);
  });
});

describe('receiver under a hostile relay', () => {
  it('keeps the last verified text and raises an alert when a frame is tampered with', async () => {
    const { sender, receiver, relay } = await setup();
    sender.setText('genuine');
    await sender.whenIdle();
    await receiver.whenSettled();

    relay.tamper = (frame) => ({ ...frame, ct: frame.ct.slice(0, -2) + 'AA' });
    sender.setText('this update gets corrupted');
    await sender.whenIdle();
    await receiver.whenSettled();

    expect(receiver.snapshot).toMatchObject({ text: 'genuine', integrityAlert: true, rejected: 1 });
  });

  it('clears the alert once a valid newer frame arrives', async () => {
    const { sender, receiver, relay } = await setup();
    relay.tamper = (frame) => ({ ...frame, seq: frame.seq + 10 });
    sender.setText('corrupted in transit');
    await sender.whenIdle();
    await receiver.whenSettled();
    expect(receiver.snapshot).toMatchObject({ text: null, integrityAlert: true });

    relay.tamper = (frame) => frame;
    sender.setText('clean');
    await sender.whenIdle();
    await receiver.whenSettled();
    expect(receiver.snapshot).toMatchObject({ text: 'clean', integrityAlert: false, rejected: 1 });
  });

  it('never shows text from malformed input', async () => {
    const { receiver, relay, shownTexts } = await setup();
    const junk = [null, 'plain text', 42, {}, { v: 1, seq: 1, iv: 'x', ct: 'y' }, { text: 'hi' }];
    junk.forEach((raw) => relay.inject(raw));
    await receiver.whenSettled();

    expect(shownTexts()).toEqual([]);
    expect(receiver.snapshot).toMatchObject({ text: null, rejected: junk.length });
  });

  it('ignores a replayed older frame, so the text cannot be rolled back', async () => {
    const { sender, receiver, relay, shownTexts } = await setup();
    sender.setText('old');
    await sender.whenIdle();
    sender.setText('new');
    await sender.whenIdle();
    await receiver.whenSettled();

    relay.inject(relay.sent[0]);
    relay.inject(relay.sent[1]);
    await receiver.whenSettled();

    expect(receiver.snapshot).toMatchObject({ text: 'new', seq: 2, integrityAlert: false });
    expect(shownTexts()).toEqual(['old', 'new']);
  });

  it('rejects a frame forged without the key', async () => {
    const { receiver, relay } = await setup();
    const attackerKey = await importKey(generateKeyText(), 'encrypt');
    relay.inject(await seal(attackerKey, SESSION, 1, 'forged'));
    await receiver.whenSettled();
    expect(receiver.snapshot).toMatchObject({ text: null, integrityAlert: true });
  });

  it('rejects everything when the link carries the wrong key', async () => {
    const { sender, connect } = await setup({ connectReceiver: false });
    sender.setText('secret');
    await sender.whenIdle();

    const receiver = await connect(generateKeyText());
    await receiver.whenSettled();
    expect(receiver.snapshot).toMatchObject({ text: null, integrityAlert: true });
  });
});

describe('receiver ordering', () => {
  it('applies frames in arrival order even though decryption is asynchronous', async () => {
    const { receiver, relay, keyText, shownTexts } = await setup();
    const key = await importKey(keyText, 'encrypt');
    // A large frame takes longer to decrypt than a small one that arrives right after it.
    const big = await seal(key, SESSION, 1, 'x'.repeat(20_000));
    const small = await seal(key, SESSION, 2, 'latest');

    relay.inject(big);
    relay.inject(small);
    await receiver.whenSettled();

    expect(receiver.snapshot.text).toBe('latest');
    expect(shownTexts().at(-1)).toBe('latest');
  });

  it('keeps the alert for a bad frame that arrives right after a slow valid one', async () => {
    const { receiver, relay, keyText } = await setup();
    const key = await importKey(keyText, 'encrypt');
    const slow = await seal(key, SESSION, 1, 'x'.repeat(20_000));

    // The malformed frame is rejected before any decryption starts. Processed out of order, the
    // slow valid frame would finish last and clear the alert, hiding that the newest data the
    // relay sent was manipulated.
    relay.inject(slow);
    relay.inject({ ...slow, seq: 2, iv: 'not-an-iv' });
    await receiver.whenSettled();

    expect(receiver.snapshot).toMatchObject({ text: 'x'.repeat(20_000), integrityAlert: true });
  });

  it('stops updating after close', async () => {
    const { sender, receiver, states } = await setup();
    receiver.close();
    const before = states.length;
    sender.setText('ignored');
    await sender.whenIdle();
    await receiver.whenSettled();
    expect(states).toHaveLength(before);
  });
});
