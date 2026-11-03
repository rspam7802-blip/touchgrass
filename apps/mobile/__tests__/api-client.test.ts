import { z } from 'zod';
import { ApiClient, ApiError } from '../src/lib/api-client';
import { jsonResponse } from '../test-utils';

const Schema = z.object({ ok: z.boolean() });

function client(fetchFn: typeof fetch, token: string | null = null): ApiClient {
  return new ApiClient({
    baseUrl: 'http://api.test/',
    appVersion: '1.2.3',
    getAccessToken: () => token,
    fetchFn,
  });
}

describe('ApiClient', () => {
  it('sends version, auth and idempotency headers and validates responses', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    await expect(
      client(fetchFn, 'tok').request('/v1/x', Schema, {
        method: 'POST',
        body: { a: 1 },
        idempotencyKey: 'rsvp_123456',
      }),
    ).resolves.toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/x');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tok',
      'idempotency-key': 'rsvp_123456',
      'x-app-version': '1.2.3',
      'content-type': 'application/json',
    });
    expect(init.body).toBe('{"a":1}');
  });
  it('maps error envelopes to ApiError', async () => {
    const err = await client(
      jest
        .fn()
        .mockResolvedValue(
          jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'no', details: { why: 'x' } } }),
        ),
    )
      .request('/v1/x', Schema)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      details: { why: 'x' },
      retryable: false,
    });
  });
  it('handles non-envelope errors, malformed bodies, bad shapes and network failures', async () => {
    await expect(
      client(jest.fn().mockResolvedValue(new Response('oops', { status: 502 }))).request(
        '/x',
        Schema,
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(
      client(jest.fn().mockResolvedValue(jsonResponse(404, { nope: true }))).request('/x', Schema),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 404 });
    await expect(
      client(jest.fn().mockResolvedValue(jsonResponse(200, { ok: 'yes' }))).request('/x', Schema),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(
      client(jest.fn().mockResolvedValue(new Response('', { status: 503 }))).request('/x', Schema),
    ).rejects.toMatchObject({ retryable: true });
    const network = await client(
      jest.fn().mockRejectedValue(new TypeError('Network request failed')),
    )
      .request('/x', Schema)
      .catch((e: unknown) => e);
    expect(network).toMatchObject({ code: 'NETWORK', retryable: true });
    await expect(
      client(jest.fn().mockRejectedValue('weird')).request('/x', Schema),
    ).rejects.toMatchObject({ message: 'Network request failed' });
    expect(new ApiError('RATE_LIMITED', 'x', 429).retryable).toBe(true);
  });
});
