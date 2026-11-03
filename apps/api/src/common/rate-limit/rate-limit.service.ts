import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

/**
 * Sliding-window-log limiter in a single Lua script (atomic across API instances).
 * ZSET of request timestamps per key; old entries trimmed each call.
 */
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end
redis.call('PEXPIRE', key, window)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = window
if oldest[2] then reset = tonumber(oldest[2]) + window - now end
return {allowed, count, reset}
`;

@Injectable()
export class RateLimitService {
  private seq = 0;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<RateLimitResult> {
    this.seq = (this.seq + 1) % 1_000_000;
    const member = `${now}:${process.pid}:${this.seq}:${Math.random().toString(36).slice(2, 8)}`;
    const [allowed, count, reset] = (await this.redis.eval(
      SCRIPT,
      1,
      `rl:${key}`,
      now,
      windowMs,
      limit,
      member,
    )) as [number, number, number];
    return {
      allowed: allowed === 1,
      limit,
      remaining: Math.max(0, limit - count),
      resetMs: Math.max(0, reset),
    };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
