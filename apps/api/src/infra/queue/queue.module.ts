import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { createRedis } from '../redis/redis.module.js';
import { QUEUES, type QueueName } from './queues.js';

export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');
export const QUEUE_REGISTRY = Symbol('QUEUE_REGISTRY');

export class QueueRegistry {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: Redis) {}

  get(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  all(): QueueName[] {
    return Object.values(QUEUES);
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env) => createRedis(env.REDIS_URL),
    },
    {
      provide: QUEUE_REGISTRY,
      inject: [QUEUE_CONNECTION],
      useFactory: (c: Redis) => new QueueRegistry(c),
    },
  ],
  exports: [QUEUE_REGISTRY, QUEUE_CONNECTION],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(QUEUE_REGISTRY) private readonly registry: QueueRegistry,
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.registry.close();
    await this.connection.quit().catch(() => undefined);
  }
}
