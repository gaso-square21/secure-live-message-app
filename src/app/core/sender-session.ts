import { seal } from './crypto';
import { SenderTransport, SessionGoneError } from './transport';

/** `gone` is final: the session no longer exists on the relay, and nothing more is sent. */
export type SenderStatus = 'idle' | 'sending' | 'synced' | 'retrying' | 'gone';

export interface SenderOptions {
  readonly sessionId: string;
  readonly key: CryptoKey;
  readonly transport: SenderTransport;
  readonly onStatus?: (status: SenderStatus) => void;
  /** Delay before retrying a failed send. Injectable for tests. */
  readonly retryDelayMs?: number;
  /**
   * Minimum time between the starts of two sends (throttle). The first edit goes out at once and
   * the latest text always goes out last, so the receiver stays live, but fast typing produces a
   * frame per interval instead of per keystroke. That means fewer requests, and the relay sees
   * less of the typing rhythm and of how the length grows. Default 150 ms; 0 disables it.
   */
  readonly minIntervalMs?: number;
}

/**
 * Sends the latest text to the relay. At most one encrypt-and-send is in flight, and sends start
 * at least `minIntervalMs` apart; edits made in between collapse into a single follow-up send, so
 * the receiver converges on the newest text and frames leave in strictly increasing sequence
 * order.
 */
export class SenderSession {
  private seq = 0;
  private pending: string | null = null;
  private pumping = false;
  private closed = false;
  /** Pending retry or throttle wait; while it runs, nothing else starts a send. */
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSendAt = Number.NEGATIVE_INFINITY;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly options: SenderOptions) {}

  setText(text: string): void {
    if (this.closed) {
      return;
    }
    this.pending = text;
    void this.pump();
  }

  /** Resolves when nothing is queued or in flight. */
  whenIdle(): Promise<void> {
    if (!this.pumping && this.pending === null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.resolveIdle();
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.timer !== null) {
      return;
    }
    this.pumping = true;
    let failed = false;
    while (this.pending !== null && !this.closed) {
      const wait = this.lastSendAt + (this.options.minIntervalMs ?? 150) - Date.now();
      if (wait > 0) {
        // Too soon after the last send: try again when the interval is over. Edits made until
        // then just replace the pending text.
        this.pumping = false;
        this.options.onStatus?.('sending');
        this.schedule(wait);
        return;
      }
      const text = this.pending;
      this.pending = null;
      this.lastSendAt = Date.now();
      this.options.onStatus?.('sending');
      try {
        // A sequence number is never reused, even when a send fails: the relay may have
        // received the frame although the response was lost.
        const frame = await seal(this.options.key, this.options.sessionId, ++this.seq, text);
        await this.options.transport.send(frame);
      } catch (error) {
        if (error instanceof SessionGoneError) {
          // Retrying a session the relay has forgotten would fail forever: stop for good.
          this.pumping = false;
          this.close();
          this.options.onStatus?.('gone');
          return;
        }
        // Keep the failed text unless something newer has been typed since.
        this.pending ??= text;
        failed = true;
        break;
      }
    }
    this.pumping = false;
    if (this.closed) {
      return;
    }
    if (failed) {
      this.options.onStatus?.('retrying');
      this.schedule(this.options.retryDelayMs ?? 1000);
      return;
    }
    this.options.onStatus?.('synced');
    this.resolveIdle();
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delayMs);
  }

  private resolveIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}
