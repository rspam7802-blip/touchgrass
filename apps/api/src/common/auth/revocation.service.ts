import { Inject, Injectable } from '@nestjs/common';
import { LIMITS } from '@touchgrass/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';

/**
 * Access tokens live 15 minutes. When a session is revoked (logout, reuse detection, suspension, deletion)
 * its id is written here for the remaining token lifetime, so the guard rejects it immediately on every instance.
 */
@Injectable()
export class SessionRevocationService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async revoke(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds)
      pipeline.set(`revoked-session:${id}`, '1', 'EX', LIMITS.tokens.accessTtlSeconds + 60);
    await pipeline.exec();
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(`revoked-session:${sessionId}`)) === 1;
  }
}
