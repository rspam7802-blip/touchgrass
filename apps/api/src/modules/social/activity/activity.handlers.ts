import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../../worker/domain-event-bus.js';
import { USER_ONBOARDED_EVENT } from '../../account/account.service.js';
import { FRIEND_ACCEPTED_EVENT } from '../graph/social-graph.service.js';
import { ActivityService } from './activity.service.js';

/** Turns domain events into feed rows. Idempotent: replays of the same event insert nothing. */
@Injectable()
export class ActivityHandlers {
  constructor(private readonly activity: ActivityService) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(FRIEND_ACCEPTED_EVENT, 'activity.squad_joined', async (e) => {
      await this.activity.record({
        sourceEventId: e.eventId,
        actorId: String(e.payload.accepterId),
        subjectUserId: String(e.payload.requesterId),
        verb: 'squad_joined',
      });
    });
    bus.subscribe(USER_ONBOARDED_EVENT, 'activity.joined', async (e) => {
      await this.activity.record({
        sourceEventId: e.eventId,
        actorId: e.aggregateId,
        verb: 'joined',
      });
    });
  }
}
