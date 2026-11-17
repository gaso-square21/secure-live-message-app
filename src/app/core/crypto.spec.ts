import { fromBase64Url, toBase64Url } from './base64url';
import { generateKeyText, importKey, IntegrityError, InvalidKeyError, open, seal } from './crypto';
import { Frame, InvalidFrameError, parseFrame } from './frame';

const SESSION = 'session-a';

async function keyPair(keyText = generateKeyText()) {
  return {
    encryptKey: await importKey(keyText, 'encrypt'),
    decryptKey: await importKey(keyText, 'decrypt'),
  };
}

/** Flips one bit in a base64url field without changing its length. */
function flipBit(value: string, byteIndex = 0): string {
  const bytes = fromBase64Url(value);
  bytes[byteIndex] ^= 0x01;
  return toBase64Url(bytes);
}

describe('crypto', () => {
  it('round-trips text, including non-ASCII and empty strings', async () => {
    const { encryptKey, decryptKey } = await keyPair();
    for (const text of ['hello', '', 'árvíztűrő tükörfúrógép 🔐', 'x'.repeat(5000)]) {
      const frame = await seal(encryptKey, SESSION, 1, text);
      expect(await open(decryptKey, SESSION, frame)).toBe(text);
    }
  });

  it('does not put the plaintext into the frame', async () => {
    const { encryptKey } = await keyPair();
    const frame = await seal(encryptKey, SESSION, 1, 'top secret');
    expect(JSON.stringify(frame)).not.toContain('top secret');
    expect(new TextDecoder().decode(fromBase64Url(frame.ct))).not.toContain('top secret');
  });

  it('uses a fresh IV for every message', async () => {
    const { encryptKey } = await keyPair();
    const ivs = new Set<string>();
    for (let seq = 1; seq <= 50; seq++) {
      ivs.add((await seal(encryptKey, SESSION, seq, 'same text')).iv);
    }
    expect(ivs.size).toBe(50);
  });

  describe('rejects manipulated frames', () => {
    let decryptKey: CryptoKey;
    let frame: Frame;

    beforeEach(async () => {
      const keys = await keyPair();
      decryptKey = keys.decryptKey;
      frame = await seal(keys.encryptKey, SESSION, 7, 'original');
    });

    it('with a bit flipped in the ciphertext body', async () => {
      const tampered = { ...frame, ct: flipBit(frame.ct, 0) };
      await expect(open(decryptKey, SESSION, tampered)).rejects.toBeInstanceOf(IntegrityError);
    });

    it('with a bit flipped in the authentication tag', async () => {
      const lastByte = fromBase64Url(frame.ct).length - 1;
      const tampered = { ...frame, ct: flipBit(frame.ct, lastByte) };
      await expect(open(decryptKey, SESSION, tampered)).rejects.toBeInstanceOf(IntegrityError);
    });

    it('with a truncated ciphertext', async () => {
      const tampered = { ...frame, ct: toBase64Url(fromBase64Url(frame.ct).slice(0, 4)) };
      await expect(open(decryptKey, SESSION, tampered)).rejects.toBeInstanceOf(IntegrityError);
    });

    it('with a modified IV', async () => {
      const tampered = { ...frame, iv: flipBit(frame.iv) };
      await expect(open(decryptKey, SESSION, tampered)).rejects.toBeInstanceOf(IntegrityError);
    });

    it('with a changed sequence number', async () => {
      const tampered = { ...frame, seq: frame.seq + 1 };
      await expect(open(decryptKey, SESSION, tampered)).rejects.toBeInstanceOf(IntegrityError);
    });

    it('when replayed into another session', async () => {
      await expect(open(decryptKey, 'session-b', frame)).rejects.toBeInstanceOf(IntegrityError);
    });

    it('when opened with a different key', async () => {
      const other = await keyPair();
      await expect(open(other.decryptKey, SESSION, frame)).rejects.toBeInstanceOf(IntegrityError);
    });
  });

  describe('keys', () => {
    it('are 256 bits and unique', () => {
      const a = generateKeyText();
      const b = generateKeyText();
      expect(fromBase64Url(a)).toHaveLength(32);
      expect(a).not.toBe(b);
    });

    it('are imported non-extractable and single-purpose', async () => {
      const { encryptKey, decryptKey } = await keyPair();
      expect(encryptKey.extractable).toBe(false);
      expect(encryptKey.usages).toEqual(['encrypt']);
      expect(decryptKey.usages).toEqual(['decrypt']);
    });

    it.each(['', 'short', 'not base64 !!', generateKeyText() + 'AAAA'])(
      'rejects malformed key text %j',
      async (keyText) => {
        await expect(importKey(keyText, 'decrypt')).rejects.toBeInstanceOf(InvalidKeyError);
      },
    );
  });
});

describe('parseFrame', () => {
  const valid = { v: 1, seq: 1, iv: 'A'.repeat(16), ct: 'AAAA' };

  it('accepts a well-formed frame and drops unknown fields', () => {
    expect(parseFrame({ ...valid, extra: 'ignored' })).toEqual(valid);
  });

  it.each([
    ['null', null],
    ['a string', 'frame'],
    ['a wrong version', { ...valid, v: 2 }],
    ['a zero sequence number', { ...valid, seq: 0 }],
    ['a fractional sequence number', { ...valid, seq: 1.5 }],
    ['a string sequence number', { ...valid, seq: '1' }],
    ['a short iv', { ...valid, iv: 'AAAA' }],
    ['a non-base64url iv', { ...valid, iv: '+'.repeat(16) }],
    ['a non-base64url ciphertext', { ...valid, ct: 'a b' }],
    ['an oversized ciphertext', { ...valid, ct: 'A'.repeat(40_000) }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseFrame(input)).toThrow(InvalidFrameError);
  });
});
