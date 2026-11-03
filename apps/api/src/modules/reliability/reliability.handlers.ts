import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EVENT_COMPLETED_EVENT } from '../events/events.service.js';
import { RSVP_CANCELLED_EVENT } from '../events/rsvp.service.js';
import { ReliabilityService } from './reliability.service.js';

/** Worker: outcomes come from finished plans (check-in vs no-show) and late cancellations. */
@Injectable()
export class ReliabilityHandlers {
  constructor(
    private readonly reliability: ReliabilityService,
    private readonly search: EventSearchService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(EVENT_COMPLETED_EVENT, 'reliability.outcomes', async (e) => {
      await this.onCompleted(e.aggregateId);
    });
    bus.subscribe(RSVP_CANCELLED_EVENT, 'reliability.late-cancel', async (e) => {
      if (e.payload.late !== true) return;
      const at =
        typeof e.payload.cancelledAt === 'string'
          ? new Date(e.payload.cancelledAt)
          : new Date(e.occurredAt);
      await this.reliability.record(String(e.payload.userId), e.aggregateId, 'late_cancel', at);
    });
  }

  async onCompleted(eventId: string): Promise<number> {
    const outcomes = await this.search.seatOutcomes(eventId);
    for (const o of outcomes)
      await this.reliability.record(o.userId, eventId, o.checkedIn ? 'check_in' : 'no_show', o.at);
    return outcomes.length;
  }
}
