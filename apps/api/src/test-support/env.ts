import { type Env, loadEnv } from '../config/env.js';

/** A complete, valid env for unit tests (fake adapters, no network). */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://touchgrass:touchgrass@localhost:5432/touchgrass',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123',
    TOKEN_HASH_PEPPER: 'test-pepper-test-pepper-test-pepper-012345',
    SIGNED_URL_SECRET: 'test-signed-url-secret-test-signed-url-0123',
    STORAGE_PROVIDER: 'memory',
    LOG_LEVEL: 'silent',
    // Tests settle refunds, transfers and KYC explicitly through signed webhooks.
    PAYMENTS_FAKE_AUTO_SETTLE: 'false',
    ...overrides,
  });
}

/** A fetch double that records calls and replies with queued responses. */
export function fakeFetch(responses: { status?: number; body: unknown }[]): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const queue = [...responses];
  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const next = queue.shift() ?? { status: 500, body: { error: 'no response queued' } };
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return Promise.resolve(new Response(text, { status: next.status ?? 200 }));
  };
  return { fetch: fn, calls };
}

export function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON string body');
  return JSON.parse(body);
}
