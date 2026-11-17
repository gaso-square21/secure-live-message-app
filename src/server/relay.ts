import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import { Frame, parseFrame } from '../app/core/frame';

interface Session {
  /** SHA-256 of the sender's write token. */
  readonly tokenHash: Buffer;
  /** Latest ciphertext frame, kept so a receiver that connects late gets the current state. */
  latest: Frame | null;
  /** The single receiver stream, if one is connected. */
  subscriber: Response | null;
  lastActive: number;
}

export interface RelayOptions {
  readonly maxSessions?: number;
  /** Sessions idle for longer than this are dropped. */
  readonly sessionTtlMs?: number;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Blind relay: stores and forwards opaque ciphertext frames. It never receives the key (which
 * lives in the URL fragment) and has no code path that could read the plaintext.
 */
export function createRelay(options: RelayOptions = {}): Router {
  const maxSessions = options.maxSessions ?? 1000;
  const sessionTtlMs = options.sessionTtlMs ?? 60 * 60 * 1000;
  const heartbeatMs = options.heartbeatMs ?? 25_000;
  const now = options.now ?? Date.now;

  const sessions = new Map<string, Session>();
  const router = Router();

  const dropExpired = () => {
    for (const [id, session] of sessions) {
      if (now() - session.lastActive > sessionTtlMs) {
        session.subscriber?.end();
        sessions.delete(id);
      }
    }
  };

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/sessions', (_req, res) => {
    dropExpired();
    if (sessions.size >= maxSessions) {
      res.status(503).json({ error: 'Too many sessions' });
      return;
    }
    const sessionId = randomBytes(16).toString('base64url');
    const writeToken = randomBytes(32).toString('base64url');
    sessions.set(sessionId, {
      tokenHash: sha256(writeToken),
      latest: null,
      subscriber: null,
      lastActive: now(),
    });
    res.status(201).json({ sessionId, writeToken });
  });

  router.put('/sessions/:id/frame', express.json({ limit: '64kb' }), (req: Request, res) => {
    const session = sessions.get(String(req.params['id']));
    if (!session) {
      res.status(404).json({ error: 'Unknown session' });
      return;
    }
    const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '';
    if (!timingSafeEqual(sha256(token), session.tokenHash)) {
      res.status(401).json({ error: 'Invalid write token' });
      return;
    }
    let frame: Frame;
    try {
      frame = parseFrame(req.body);
    } catch {
      res.status(400).json({ error: 'Malformed frame' });
      return;
    }
    // Not a security boundary (the receiver enforces ordering itself), but it keeps a delayed
    // request from overwriting the stored latest frame with an older one.
    if (session.latest && frame.seq <= session.latest.seq) {
      res.status(409).json({ error: 'Stale frame' });
      return;
    }
    session.latest = frame;
    session.lastActive = now();
    if (session.subscriber) {
      writeFrame(session.subscriber, frame);
    }
    res.status(204).end();
  });

  router.get('/sessions/:id/events', (req, res) => {
    const session = sessions.get(String(req.params['id']));
    if (!session) {
      res.status(404).json({ error: 'Unknown session' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    // One receiver per session: the newest connection wins. The old one is told why, so its
    // client does not reconnect and start a tug of war.
    if (session.subscriber) {
      session.subscriber.write('event: replaced\ndata: {}\n\n');
      session.subscriber.end();
    }
    session.subscriber = res;
    session.lastActive = now();
    if (session.latest) {
      writeFrame(res, session.latest);
    }

    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      if (session.subscriber === res) {
        session.subscriber = null;
      }
    });
  });

  return router;
}

function writeFrame(res: Response, frame: Frame): void {
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
}
