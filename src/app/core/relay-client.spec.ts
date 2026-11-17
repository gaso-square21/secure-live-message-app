import { Frame } from './frame';
import { RelayClient } from './relay-client';
import { SessionGoneError } from './transport';

const FRAME: Frame = { v: 1, seq: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVydGV4dA' };

describe('RelayClient sender transport', () => {
  const sendWithStatus = (status: number) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
    const transport = new RelayClient().senderTransport({ sessionId: 's/1', writeToken: 'tok' });
    return transport.send(FRAME);
  };

  afterEach(() => vi.restoreAllMocks());

  it('sends the frame with the write token and resolves on success', async () => {
    await expect(sendWithStatus(204)).resolves.toBeUndefined();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/sessions/s%2F1/frame');
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(init?.body as string)).toEqual(FRAME);
  });

  it('reports a forgotten session as permanent', async () => {
    await expect(sendWithStatus(404)).rejects.toBeInstanceOf(SessionGoneError);
  });

  it.each([409, 500, 503])('reports status %i as a failure worth retrying', async (status) => {
    const error = await sendWithStatus(status).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SessionGoneError);
  });
});
