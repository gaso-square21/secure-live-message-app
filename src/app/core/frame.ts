/**
 * Wire format shared by the browser and the relay server.
 * The server treats `iv` and `ct` as opaque strings; it only reads `seq`.
 */
export const PROTOCOL_VERSION = 1;

/** Upper bound for the base64url ciphertext, enforced on both ends. */
export const MAX_CIPHERTEXT_CHARS = 32_768;

/** 96-bit IV encoded as unpadded base64url. */
const IV_CHARS = 16;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface Frame {
  /** Protocol version. */
  readonly v: number;
  /** Strictly increasing per session; authenticated through the AAD. */
  readonly seq: number;
  /** AES-GCM IV, base64url. */
  readonly iv: string;
  /** AES-GCM ciphertext with the 128-bit tag appended, base64url. */
  readonly ct: string;
}

export class InvalidFrameError extends Error {
  constructor(reason: string) {
    super(`Invalid frame: ${reason}`);
    this.name = 'InvalidFrameError';
  }
}

/** Validates the shape of untrusted input. Says nothing about authenticity. */
export function parseFrame(input: unknown): Frame {
  if (typeof input !== 'object' || input === null) {
    throw new InvalidFrameError('not an object');
  }
  const { v, seq, iv, ct } = input as Record<string, unknown>;
  if (v !== PROTOCOL_VERSION) {
    throw new InvalidFrameError('unsupported version');
  }
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
    throw new InvalidFrameError('bad sequence number');
  }
  if (typeof iv !== 'string' || iv.length !== IV_CHARS || !BASE64URL.test(iv)) {
    throw new InvalidFrameError('bad iv');
  }
  if (typeof ct !== 'string' || ct.length > MAX_CIPHERTEXT_CHARS || !BASE64URL.test(ct)) {
    throw new InvalidFrameError('bad ciphertext');
  }
  return { v, seq, iv, ct };
}
