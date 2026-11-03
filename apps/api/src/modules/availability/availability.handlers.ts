import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { AVAILABILITY_SET_EVENT, AvailabilityService } from './availability.service.js';

/** Worker: tells the squad when someone becomes free (category "free_now", respects preferences). */
@Injectable()
export class AvailabilityHandlers {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(AVAILABILITY_SET_EVENT, 'availability.notify-squad', async (e) => {
      await this.notify(
        String(e.payload.userId),
        typeof e.payload.note === 'string' ? e.payload.note : '',
      );
    });
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
