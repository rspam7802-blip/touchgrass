import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { ActivityService } from '../social/activity/activity.service.js';
import { EVENT_CREATED_EVENT } from './events.service.js';
import { RSVP_GOING_EVENT } from './plus-one/plus-one-claim.service.js';

/**
 * Squad feed rows for plans (F-SOC-04): "X plotted …" and "X is pulling up to …". Rows are written for
 * every plan; each viewer only sees rows whose plan they can see (the events title resolver filters them).
 */
@Injectable()
export class EventActivityHandlers {
  constructor(private readonly activity: ActivityService) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(EVENT_CREATED_EVENT, 'activity.plotted', async (e) => {
      await this.activity.record({
        sourceEventId: e.eventId,
        actorId: String(e.payload.creatorUserId),
        verb: 'plotted',
        objectType: 'event',
        objectId: e.aggregateId,
        cityId: String(e.payload.cityId),
      });
    });
    bus.subscribe(RSVP_GOING_EVENT, 'activity.pulled_up', async (e) => {
      await this.activity.record({
        sourceEventId: e.eventId,
        actorId: String(e.payload.userId),
        verb: 'pulled_up',
        objectType: 'event',
        objectId: e.aggregateId,
      });
    });
  }
}
