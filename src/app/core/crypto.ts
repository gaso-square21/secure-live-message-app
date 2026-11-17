import { fromBase64Url, toBase64Url } from './base64url';
import { Frame, PROTOCOL_VERSION } from './frame';

const KEY_BYTES = 32;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Thrown when a frame fails authentication. Wrong key and tampering are indistinguishable. */
export class IntegrityError extends Error {
  constructor() {
    super('Frame failed authentication');
    this.name = 'IntegrityError';
  }
}

export class InvalidKeyError extends Error {
  constructor() {
    super('Invalid session key');
    this.name = 'InvalidKeyError';
  }
}

/** Generates a fresh AES-256 key and returns it in the form that goes into the link fragment. */
export function generateKeyText(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/**
 * Imports a key from its link-fragment form. The resulting key is non-extractable and limited
 * to one direction, so a sender key cannot decrypt and a receiver key cannot encrypt.
 */
export async function importKey(keyText: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64Url(keyText);
  } catch {
    throw new InvalidKeyError();
  }
  if (raw.length !== KEY_BYTES) {
    throw new InvalidKeyError();
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

/**
 * Additional authenticated data. Binding the session and sequence number means a frame cannot
 * be moved to another session or given a different position without failing authentication.
 */
function additionalData(sessionId: string, seq: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([PROTOCOL_VERSION, sessionId, seq]));
}

export async function seal(
  key: CryptoKey,
  sessionId: string,
  seq: number,
  plaintext: string,
): Promise<Frame> {
  // Random IV per message: safe for far more messages than one session will ever send, and
  // unlike a counter it cannot repeat if the sender's state is lost.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(sessionId, seq) },
    key,
    encoder.encode(plaintext),
  );
  return {
    v: PROTOCOL_VERSION,
    seq,
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  };
}

/** Returns the plaintext, or throws IntegrityError. Never returns unauthenticated data. */
export async function open(key: CryptoKey, sessionId: string, frame: Frame): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64Url(frame.iv),
        additionalData: additionalData(sessionId, frame.seq),
      },
      key,
      fromBase64Url(frame.ct),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new IntegrityError();
  }
}
