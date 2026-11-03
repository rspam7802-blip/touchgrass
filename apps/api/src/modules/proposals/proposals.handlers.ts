import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  PROPOSAL_INVITED_EVENT,
  PROPOSAL_LOCKED_EVENT,
  ProposalsService,
} from './proposals.service.js';

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Worker: "your vote is wanted" to invitees, and "locked in" with a link to the new plan. */
@Injectable()
export class ProposalsHandlers {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(PROPOSAL_INVITED_EVENT, 'proposals.push-invited', async (e) => {
      const creatorId = String(e.payload.creatorId);
      const [names, title] = await Promise.all([
        this.profiles.displayNames([creatorId]),
        this.proposals.titleOf(e.aggregateId),
      ]);
      const name = names.get(creatorId) ?? '';
      await this.notifications.notify(ids(e.payload.userIds), 'proposal_invited', {
        name,
        title: title ?? '',
        proposalId: e.aggregateId,
      });
    });
    bus.subscribe(PROPOSAL_LOCKED_EVENT, 'proposals.push-locked', async (e) => {
      const title = typeof e.payload.title === 'string' ? e.payload.title : '';
      await this.notifications.notify(ids(e.payload.userIds), 'proposal_locked', {
        title,
        eventId: String(e.payload.eventId),
      });
    });
  }
}
