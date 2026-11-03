import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { ActivityService } from '../social/activity/activity.service.js';
import { LORE_ADDED_EVENT, LORE_CHANGED_EVENT, LoreService } from './lore.service.js';

/** Worker: redraw album covers; a squad activity row for someone's first photo in an album. */
@Injectable()
export class LoreHandlers {
  constructor(
    private readonly lore: LoreService,
    private readonly activity: ActivityService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(LORE_ADDED_EVENT, 'lore.cover', async (e) => {
      await this.lore.refreshCover(e.aggregateId);
    });
    bus.subscribe(LORE_CHANGED_EVENT, 'lore.cover-changed', async (e) => {
      await this.lore.refreshCover(e.aggregateId);
    });
    bus.subscribe(LORE_ADDED_EVENT, 'activity.lore_posted', async (e) => {
      if (e.payload.first !== true) return;
      const uploaderId = String(e.payload.uploaderId);
      await this.activity.record({
        sourceEventId: e.eventId,
        actorId: uploaderId,
        verb: 'lore_posted',
        objectType: 'event',
        objectId: e.aggregateId,
        cityId: typeof e.payload.cityId === 'string' ? e.payload.cityId : null,
      });
    });
  }
}
