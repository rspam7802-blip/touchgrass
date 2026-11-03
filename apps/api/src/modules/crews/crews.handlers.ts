import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  CREW_APPROVED_EVENT,
  CREW_INVITED_EVENT,
  CREW_REQUESTED_EVENT,
  CrewsService,
} from './crews.service.js';

/** Worker: crew invites, join requests (to admins) and approvals as push notifications. */
@Injectable()
export class CrewsHandlers {
  constructor(
    private readonly crews: CrewsService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(CREW_INVITED_EVENT, 'crews.push-invited', async (e) => {
      const ids = Array.isArray(e.payload.userIds) ? e.payload.userIds.map(String) : [];
      await this.send(ids, e.aggregateId, String(e.payload.inviterId), 'crew_invited');
    });
    bus.subscribe(CREW_REQUESTED_EVENT, 'crews.push-requested', async (e) => {
      await this.send(
        await this.crews.adminIds(e.aggregateId),
        e.aggregateId,
        String(e.payload.userId),
        'crew_requested',
      );
    });
    bus.subscribe(CREW_APPROVED_EVENT, 'crews.push-approved', async (e) => {
      await this.send([String(e.payload.userId)], e.aggregateId, null, 'crew_approved');
    });
  }

  private async send(
    to: string[],
    crewId: string,
    actorId: string | null,
    kind: 'crew_invited' | 'crew_requested' | 'crew_approved',
  ): Promise<number> {
    if (to.length === 0) return 0;
    const [names, crewNames] = await Promise.all([
      actorId ? this.profiles.displayNames([actorId]) : Promise.resolve(new Map<string, string>()),
      this.crews.names([crewId]),
    ]);
    const crew = crewNames.get(crewId) ?? '';
    const name = actorId ? (names.get(actorId) ?? '') : '';
    const sent = await this.notifications.notify(to, kind, { name, crew, crewId });
    return sent.pushed + sent.deferred;
  }
}
