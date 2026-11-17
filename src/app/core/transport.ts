import { Frame } from './frame';

/**
 * The relay no longer knows the session: it expired after being idle, or never existed. Unlike a
 * network error this is permanent, so retrying cannot help.
 */
export class SessionGoneError extends Error {
  constructor() {
    super('Session no longer exists');
    this.name = 'SessionGoneError';
  }
}

export interface SenderTransport {
  /**
   * Resolves once the relay has accepted the frame. Rejects with `SessionGoneError` when the
   * session no longer exists, and with any other error for failures worth retrying.
   */
  send(frame: Frame): Promise<void>;
}

export interface ReceiverHandlers {
  /** Untrusted data straight from the relay. */
  onFrame(raw: unknown): void;
  /**
   * `lost` means the transport is retrying; `closed` and `replaced` are final.
   */
  onConnection(status: 'open' | 'lost' | 'closed' | 'replaced'): void;
}

export interface ReceiverTransport {
  /** Starts delivering frames. Returns a function that stops the subscription. */
  subscribe(handlers: ReceiverHandlers): () => void;
}
