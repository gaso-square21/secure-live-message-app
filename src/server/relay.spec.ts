import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createRelay, RelayOptions } from './relay';

const frame = (seq: number, ct = 'AAAA') => ({ v: 1, seq, iv: 'A'.repeat(16), ct });

/** Minimal SSE reader over fetch, so the test needs no EventSource implementation. */
async function openStream(url: string) {
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (): Promise<{ event: string; data: unknown }> => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data !== undefined) {
          return { event: /^event: (.*)$/m.exec(block)?.[1] ?? 'message', data: JSON.parse(data) };
        }
        continue;
      }
      const { value, done } = await reader.read();
      if (done) {
        throw new Error('stream ended');
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { response, next, close: () => abort.abort() };
}

describe('relay', () => {
  let server: Server;
  let base: string;
  let clock: number;
  const streams: { close: () => void }[] = [];

  const start = async (options: RelayOptions = {}) => {
    const app = express();
    app.use('/api', createRelay({ now: () => clock, ...options }));
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  };

  const createSession = async () => {
    const response = await fetch(`${base}/sessions`, { method: 'POST' });
    return (await response.json()) as { sessionId: string; writeToken: string };
  };

  const put = (sessionId: string, token: string, body: unknown) =>
    fetch(`${base}/sessions/${sessionId}/frame`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const subscribe = async (sessionId: string) => {
    const stream = await openStream(`${base}/sessions/${sessionId}/events`);
    streams.push(stream);
    return stream;
  };

  beforeEach(() => {
    clock = 1_000_000;
  });

  afterEach(async () => {
    streams.splice(0).forEach((stream) => stream.close());
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('creates sessions with unguessable, distinct identifiers', async () => {
    await start();
    const a = await createSession();
    const b = await createSession();
    expect(a.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.writeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.writeToken).not.toBe(b.writeToken);
  });

  it('forwards consecutive frames to the subscriber unchanged', async () => {
    await start();
    const { sessionId, writeToken } = await createSession();
    const stream = await subscribe(sessionId);
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream');

    expect((await put(sessionId, writeToken, frame(1, 'AAAA'))).status).toBe(204);
    expect((await stream.next()).data).toEqual(frame(1, 'AAAA'));
    expect((await put(sessionId, writeToken, frame(2, 'BBBB'))).status).toBe(204);
    expect((await stream.next()).data).toEqual(frame(2, 'BBBB'));
  });

  it('replays only the latest frame to a receiver that connects late', async () => {
    await start();
    const { sessionId, writeToken } = await createSession();
    await put(sessionId, writeToken, frame(1));
    await put(sessionId, writeToken, frame(2, 'BBBB'));

    const stream = await subscribe(sessionId);
    expect((await stream.next()).data).toEqual(frame(2, 'BBBB'));
  });

  it('requires the write token to publish', async () => {
    await start();
    const { sessionId } = await createSession();
    const other = await createSession();

    expect((await put(sessionId, 'wrong', frame(1))).status).toBe(401);
    expect((await put(sessionId, other.writeToken, frame(1))).status).toBe(401);
    const noHeader = await fetch(`${base}/sessions/${sessionId}/frame`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frame(1)),
    });
    expect(noHeader.status).toBe(401);
  });

  it('rejects malformed, oversized and stale frames', async () => {
    await start();
    const { sessionId, writeToken } = await createSession();

    expect((await put(sessionId, writeToken, { text: 'plaintext' })).status).toBe(400);
    expect((await put(sessionId, writeToken, frame(1, 'A'.repeat(40_000)))).status).toBe(400);
    expect((await put(sessionId, writeToken, frame(1, 'A'.repeat(200_000)))).status).toBe(413);

    expect((await put(sessionId, writeToken, frame(5))).status).toBe(204);
    expect((await put(sessionId, writeToken, frame(5))).status).toBe(409);
    expect((await put(sessionId, writeToken, frame(4))).status).toBe(409);
  });

  it('returns 404 for unknown sessions', async () => {
    await start();
    expect((await put('missing', 'token', frame(1))).status).toBe(404);
    expect((await fetch(`${base}/sessions/missing/events`)).status).toBe(404);
  });

  it('lets a new receiver take over and tells the old one it was replaced', async () => {
    await start();
    const { sessionId, writeToken } = await createSession();
    const first = await subscribe(sessionId);
    const second = await subscribe(sessionId);

    expect((await first.next()).event).toBe('replaced');
    await expect(first.next()).rejects.toThrow('stream ended');

    await put(sessionId, writeToken, frame(1));
    expect((await second.next()).data).toEqual(frame(1));
  });

  it('expires idle sessions and caps the number of live ones', async () => {
    await start({ maxSessions: 2, sessionTtlMs: 1000 });
    const old = await createSession();
    await createSession();
    expect((await fetch(`${base}/sessions`, { method: 'POST' })).status).toBe(503);

    clock += 1001;
    expect((await fetch(`${base}/sessions`, { method: 'POST' })).status).toBe(201);
    expect((await put(old.sessionId, old.writeToken, frame(1))).status).toBe(404);
  });

  it('marks every response as uncacheable', async () => {
    await start();
    const response = await fetch(`${base}/sessions`, { method: 'POST' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
