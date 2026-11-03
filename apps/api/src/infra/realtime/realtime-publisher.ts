import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import {
  type ChatServerToClientEvents,
  type EventsServerToClientEvents,
  SOCKET_NAMESPACES,
} from '@touchgrass/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

type Args<E, K extends keyof E> = E[K] extends (...args: infer A) => void ? A : never;

/**
 * Publishes Socket.IO events from any process (API, worker) through Redis; the realtime gateways' Redis
 * adapter delivers them to sockets on every instance. Publishing is fire-and-forget: the database is the
 * source of truth and clients refetch on reconnect.
 */
@Injectable()
export class RealtimePublisher {
  private readonly chat: Emitter;
  private readonly events: Emitter;

  constructor(@Inject(REDIS) redis: Redis) {
    const root = new Emitter(redis);
    this.chat = root.of(SOCKET_NAMESPACES.chat);
    this.events = root.of(SOCKET_NAMESPACES.events);
  }

  toChat<K extends keyof ChatServerToClientEvents>(
    rooms: string | string[],
    event: K,
    ...args: Args<ChatServerToClientEvents, K>
  ): void {
    this.chat.to(rooms).emit(event, ...(args as unknown[]));
  }

  toEvents<K extends keyof EventsServerToClientEvents>(
    rooms: string | string[],
    event: K,
    ...args: Args<EventsServerToClientEvents, K>
  ): void {
    this.events.to(rooms).emit(event, ...(args as unknown[]));
  }
}

@Global()
@Module({ providers: [RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimePublisherModule {}
