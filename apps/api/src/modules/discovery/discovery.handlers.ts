import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import {
  EVENT_CANCELLED_EVENT,
  EVENT_CREATED_EVENT,
  EVENT_UPDATED_EVENT,
} from '../events/events.service.js';
import { FEED_EPOCH_KEY } from './discovery.service.js';

/**
 * Worker: a plan was published, changed or cancelled, so every cached ranked feed is stale. Bumping the epoch
 * makes the next first-page request rank afresh instead of reusing a snapshot from before the change (a new
 * plan showed up for others only after the 5-minute cache ran out).
 */
@Injectable()
export class DiscoveryHandlers {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  registerOn(bus: DomainEventBus): void {
    for (const type of [EVENT_CREATED_EVENT, EVENT_UPDATED_EVENT, EVENT_CANCELLED_EVENT])
      bus.subscribe(type, `discovery.feed-epoch.${type}`, async () => {
        await this.redis.incr(FEED_EPOCH_KEY);
      });
  }
}
