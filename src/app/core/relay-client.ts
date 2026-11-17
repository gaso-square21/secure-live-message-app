import { Injectable } from '@angular/core';
import { Frame } from './frame';
import {
  ReceiverHandlers,
  ReceiverTransport,
  SenderTransport,
  SessionGoneError,
} from './transport';

export interface CreatedSession {
  readonly sessionId: string;
  readonly writeToken: string;
}

/** Browser-side access to the relay API. The only place that talks to the network. */
@Injectable({ providedIn: 'root' })
export class RelayClient {
  async createSession(): Promise<CreatedSession> {
    const response = await fetch('/api/sessions', { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Could not create session (${response.status})`);
    }
    return (await response.json()) as CreatedSession;
  }

  senderTransport(session: CreatedSession): SenderTransport {
    const url = `/api/sessions/${encodeURIComponent(session.sessionId)}/frame`;
    return {
      async send(frame: Frame): Promise<void> {
        const response = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.writeToken}`,
          },
          body: JSON.stringify(frame),
        });
        if (response.status === 404) {
          throw new SessionGoneError();
        }
        if (!response.ok) {
          throw new Error(`Relay rejected frame (${response.status})`);
        }
      },
    };
  }

  receiverTransport(sessionId: string): ReceiverTransport {
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events`;
    return {
      subscribe(handlers: ReceiverHandlers): () => void {
        const source = new EventSource(url);
        source.onopen = () => handlers.onConnection('open');
        source.onmessage = (event: MessageEvent<string>) => {
          let raw: unknown = null;
          try {
            raw = JSON.parse(event.data);
          } catch {
            // Leave as null; the session counts it as a rejected frame.
          }
          handlers.onFrame(raw);
        };
        source.addEventListener('replaced', () => {
          source.close();
          handlers.onConnection('replaced');
        });
        // EventSource retries by itself after a dropped connection (readyState CONNECTING) and
        // gives up for good on an HTTP error such as 404 (readyState CLOSED).
        source.onerror = () =>
          handlers.onConnection(source.readyState === EventSource.CLOSED ? 'closed' : 'lost');
        return () => source.close();
      },
    };
  }
}
