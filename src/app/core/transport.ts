import { Frame } from './frame';

export interface SenderTransport {
  /** Resolves once the relay has accepted the frame; rejects on any failure. */
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
