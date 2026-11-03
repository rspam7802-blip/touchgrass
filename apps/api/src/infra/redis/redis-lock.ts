import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../../common/errors/app-error.js';

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/**
 * Short distributed mutex (SET NX PX + token-checked release) so only one instance mutates a resource at a time
 * (F-EVT-08: no double booking). Callers still use DB row locks inside; this lock keeps contention off Postgres.
 */
export async function withRedisLock<T>(
  redis: Redis,
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const ttl = opts.ttlMs ?? 5000;
  const deadline = Date.now() + (opts.waitMs ?? 8000);
  const token = randomUUID();
  // Short, jittered polling: lock holders finish in milliseconds, so long sleeps only add tail latency.
  let delay = 2;
  for (;;) {
    if ((await redis.set(`lock:${key}`, token, 'PX', ttl, 'NX')) === 'OK') break;
    if (Date.now() > deadline) throw new AppError('CONFLICT', 'Busy, try again');
    await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * delay)));
    delay = Math.min(delay * 2, 12);
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, 1, `lock:${key}`, token);
  }
}
