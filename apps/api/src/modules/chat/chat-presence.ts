import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';

const KEY = (conversationId: string, userId: string): string =>
  `presence:chat:${conversationId}:${userId}`;
/** Sockets refresh presence while a chat is open; it lapses on its own if a device vanishes. */
export const PRESENCE_TTL_SECONDS = 90;

/** "Is this person looking at this chat right now?" — skips pushes for messages they can already see. */
@Injectable()
export class ChatPresence {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async enter(conversationId: string, userId: string): Promise<void> {
    await this.redis.set(KEY(conversationId, userId), '1', 'EX', PRESENCE_TTL_SECONDS);
  }

  async leave(conversationId: string, userId: string): Promise<void> {
    await this.redis.del(KEY(conversationId, userId));
  }

  async isPresent(conversationId: string, userId: string): Promise<boolean> {
    return (await this.redis.exists(KEY(conversationId, userId))) === 1;
  }
}
