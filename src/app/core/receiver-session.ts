import { open } from './crypto';
import { parseFrame } from './frame';
import { ReceiverTransport } from './transport';

export interface ReceiverState {
  readonly connection: 'connecting' | 'open' | 'lost' | 'closed' | 'replaced';
  /** Last text that passed authentication, or null if none has arrived yet. */
  readonly text: string | null;
  /** Sequence number of `text`; 0 before the first valid frame. */
  readonly seq: number;
  /** True when the most recent frame was rejected, so `text` may be out of date. */
  readonly integrityAlert: boolean;
  /** Number of frames rejected as malformed or unauthenticated. */
  readonly rejected: number;
}

export interface ReceiverOptions {
  readonly sessionId: string;
  readonly key: CryptoKey;
  readonly transport: ReceiverTransport;
  readonly onState: (state: ReceiverState) => void;
}

/**
 * Turns untrusted frames into verified text. A frame changes the visible text only if it
 * authenticates under the session key and carries a higher sequence number than the last
 * accepted one. Anything else leaves the text untouched.
 */
export class ReceiverSession {
  private state: ReceiverState = {
    connection: 'connecting',
    text: null,
    seq: 0,
    integrityAlert: false,
    rejected: 0,
  };
  /** Decryption is async, so frames are chained to keep them in arrival order. */
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: ReceiverOptions) {
    this.unsubscribe = options.transport.subscribe({
      onFrame: (raw) => {
        // The catch keeps the chain alive: one failure (for example in an onState callback)
        // must not stop every later frame from being processed.
        this.queue = this.queue.then(() => this.handle(raw)).catch(() => undefined);
      },
      onConnection: (connection) => this.update({ connection }),
    });
  }

  get snapshot(): ReceiverState {
    return this.state;
  }

  /** Resolves when every frame received so far has been processed. */
  whenSettled(): Promise<void> {
    return this.queue;
  }

  close(): void {
    this.closed = true;
    this.unsubscribe();
  }

  private async handle(raw: unknown): Promise<void> {
    let text: string;
    let seq: number;
    try {
      const frame = parseFrame(raw);
      text = await open(this.options.key, this.options.sessionId, frame);
      seq = frame.seq;
    } catch {
      this.update({ integrityAlert: true, rejected: this.state.rejected + 1 });
      return;
    }
    // Authentic but not newer: a replay. The relay legitimately resends the latest frame after
    // a reconnect, so this is ignored rather than reported.
    if (seq <= this.state.seq) {
      return;
    }
    this.update({ text, seq, integrityAlert: false });
  }

  private update(patch: Partial<ReceiverState>): void {
    if (this.closed) {
      return;
    }
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }
}
