import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { RSVP_CHECKED_IN_EVENT } from '../events/check-in.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { REFERRAL_REWARDED_EVENT } from './referral-codes.service.js';
import { ReferralsService } from './referrals.service.js';

/** Worker: a referred person's first check-in settles their referral; the referrer hears about rewards. */
@Injectable()
export class ReferralsHandlers {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(RSVP_CHECKED_IN_EVENT, 'referrals.first-check-in', async (e) => {
      await this.referrals.onCheckIn(String(e.payload.userId), new Date(e.occurredAt));
    });
    bus.subscribe(REFERRAL_REWARDED_EVENT, 'referrals.push-rewarded', async (e) => {
      const refereeId = String(e.payload.refereeId);
      const name = (await this.profiles.displayNames([refereeId])).get(refereeId) ?? '';
      await this.notifications.notify([String(e.payload.referrerId)], 'referral_rewarded', {
        name,
      });
    });
  }
}
