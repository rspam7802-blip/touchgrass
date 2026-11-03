import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  AVAILABILITY_PINGED_EVENT,
  AVAILABILITY_SET_EVENT,
  AvailabilityService,
} from './availability.service.js';

/** Worker: tells the squad when someone becomes free (category "free_now", respects preferences). */
@Injectable()
export class AvailabilityHandlers {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(AVAILABILITY_PINGED_EVENT, 'availability.notify-ping', async (e) => {
      await this.notifyPing(String(e.payload.fromId), String(e.payload.toId));
    });
    bus.subscribe(AVAILABILITY_SET_EVENT, 'availability.notify-squad', async (e) => {
      await this.notify(
        String(e.payload.userId),
        typeof e.payload.note === 'string' ? e.payload.note : '',
      );
    });
  }

  /** Tells the pinged person who wants to meet up; re-checks the block in case one happened since. */
  async notifyPing(fromId: string, toId: string): Promise<number> {
    if (!(await this.availability.audience(fromId)).includes(toId)) return 0;
    const name = (await this.profiles.displayNames([fromId])).get(fromId) ?? '';
    const sent = await this.notifications.notify(
      [toId],
      'free_now_ping',
      { name, userId: fromId },
      { collapseKey: `ping-${fromId}` },
    );
    return sent.pushed + sent.deferred;
  }

  async notify(userId: string, note: string): Promise<number> {
    const audience = await this.availability.audience(userId);
    if (audience.length === 0) return 0;
    const name = (await this.profiles.displayNames([userId])).get(userId) ?? '';
    const sent = await this.notifications.notify(
      audience,
      note.length > 0 ? 'free_now_note' : 'free_now',
      { name, note },
      { collapseKey: `free-${userId}` },
    );
    return sent.pushed + sent.deferred;
  }
}
