import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { EVENT_INVITED_EVENT } from '../events/event-invites.service.js';
import { JOIN_DECIDED_EVENT, JOIN_REQUESTED_EVENT } from '../events/event-join-requests.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import {
  EVENT_CANCELLED_EVENT,
  EVENT_COMPLETED_EVENT,
  EVENT_HOST_ADDED_EVENT,
  EVENT_UPDATED_EVENT,
} from '../events/events.service.js';
import { WAITLIST_OFFERED_EVENT } from '../events/waitlist.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  FRIEND_ACCEPTED_EVENT,
  FRIEND_REQUESTED_EVENT,
} from '../social/graph/social-graph.service.js';
import { RemindersService } from './reminders.service.js';
import { SquadSignalsService } from './squad-signals.service.js';
import { RSVP_CHECKED_IN_EVENT } from '../events/check-in.service.js';
import { RSVP_GOING_EVENT } from '../events/plus-one/plus-one-claim.service.js';
import { CITY_LAUNCHED_EVENT } from '../cities/city-waitlist.service.js';

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * Worker: notifications that follow from things people did (F-NOT-02, F-EVT-16): squad requests and
 * acceptances, plan invites, edits, cancellations, co-host invites, waitlist offers and the after-plan
 * "How was it?". Plan copy names the plan only (never its spot), so mystery plans stay mystery-safe.
 */
@Injectable()
export class RemindersHandlers {
  constructor(
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
    private readonly store: EventStore,
    private readonly search: EventSearchService,
    private readonly squadSignals: SquadSignalsService,
  ) {}

  private async name(userId: string): Promise<string> {
    return (await this.profiles.displayNames([userId])).get(userId) ?? '';
  }

  private async plan(eventId: string) {
    const [core] = await this.store.coresByIds([eventId]);
    return core && !core.held ? core : null;
  }

  registerOn(bus: DomainEventBus): void {
    // Social proof from the squad (Phase 13).
    bus.subscribe(RSVP_GOING_EVENT, 'notify.squad-pulling-up', async (e) => {
      await this.squadSignals.afterPullUp(String(e.payload.eventId), String(e.payload.userId));
    });
    bus.subscribe(RSVP_CHECKED_IN_EVENT, 'notify.squad-outside', async (e) => {
      await this.squadSignals.afterCheckIn(String(e.payload.userId));
    });
    // A city opened (F-GRW-03): everyone waiting for it hears first.
    bus.subscribe(CITY_LAUNCHED_EVENT, 'notify.city-launched', async (e) => {
      const userIds = ids(e.payload.userIds);
      if (userIds.length === 0) return;
      await this.notifications.notify(
        userIds,
        'city_launched',
        { city: String(e.payload.cityName) },
        { collapseKey: `city:${e.aggregateId}` },
      );
    });
    bus.subscribe(FRIEND_REQUESTED_EVENT, 'notify.friend-requested', async (e) => {
      const from = String(e.payload.requesterId);
      await this.notifications.notify([String(e.payload.recipientId)], 'friend_requested', {
        name: await this.name(from),
      });
    });
    bus.subscribe(FRIEND_ACCEPTED_EVENT, 'notify.friend-accepted', async (e) => {
      const accepter = String(e.payload.accepterId);
      await this.notifications.notify([String(e.payload.requesterId)], 'friend_accepted', {
        name: await this.name(accepter),
        userId: accepter,
      });
    });
    bus.subscribe(EVENT_INVITED_EVENT, 'notify.event-invited', async (e) => {
      const core = await this.plan(String(e.payload.eventId));
      if (!core || core.status !== 'published') return;
      const inviter = String(e.payload.inviterId);
      await this.notifications.notify(ids(e.payload.inviteeIds), 'event_invited', {
        name: await this.name(inviter),
        title: core.title,
        eventId: core.id,
        when: await this.reminders.when(core),
      });
    });
    // Private plans (D-179): hosts hear about a request; the person hears when they are approved. A
    // declined request is not announced.
    bus.subscribe(JOIN_REQUESTED_EVENT, 'notify.join-requested', async (e) => {
      const core = await this.plan(String(e.payload.eventId));
      if (!core || core.status !== 'published') return;
      const hosts = (await this.store.hosts(core.id))
        .filter((h) => h.role !== 'welcome_host')
        .map((h) => h.userId);
      await this.notifications.notify(
        hosts,
        'join_requested',
        { name: await this.name(String(e.payload.userId)), title: core.title, eventId: core.id },
        { collapseKey: `join-requested:${core.id}` },
      );
    });
    bus.subscribe(JOIN_DECIDED_EVENT, 'notify.join-decided', async (e) => {
      if (e.payload.approved !== true) return;
      const core = await this.plan(String(e.payload.eventId));
      if (!core || core.status !== 'published') return;
      await this.notifications.notify([String(e.payload.userId)], 'join_approved', {
        title: core.title,
        eventId: core.id,
      });
    });
    bus.subscribe(EVENT_UPDATED_EVENT, 'notify.event-updated', async (e) => {
      const core = await this.plan(String(e.payload.eventId));
      if (!core || core.status !== 'published') return;
      const by = String(e.payload.byUserId);
      const seats = (await this.search.seatHoldersMany([core.id])).get(core.id) ?? [];
      await this.notifications.notify(
        seats.filter((u) => u !== by),
        'event_updated',
        { title: core.title, eventId: core.id, when: await this.reminders.when(core) },
        { collapseKey: `plan-${core.id}` },
      );
    });
    bus.subscribe(EVENT_CANCELLED_EVENT, 'notify.event-cancelled', async (e) => {
      if (e.payload.wasPublished !== true) return;
      const [core] = await this.store.coresByIds([e.aggregateId]);
      if (!core) return;
      const by = typeof e.payload.byUserId === 'string' ? e.payload.byUserId : null;
      const seats = (await this.search.seatHoldersMany([core.id])).get(core.id) ?? [];
      await this.notifications.notify(
        seats.filter((u) => u !== by),
        'event_cancelled',
        { title: core.title, eventId: core.id },
        { collapseKey: `plan-${core.id}` },
      );
    });
    bus.subscribe(EVENT_HOST_ADDED_EVENT, 'notify.host-added', async (e) => {
      const core = await this.plan(String(e.payload.eventId));
      const userId = String(e.payload.userId);
      if (!core || userId === String(e.payload.byUserId)) return;
      await this.notifications.notify([userId], 'event_host_added', {
        title: core.title,
        eventId: core.id,
        when: await this.reminders.when(core),
      });
    });
    bus.subscribe(WAITLIST_OFFERED_EVENT, 'notify.waitlist-offer', async (e) => {
      const core = await this.plan(String(e.payload.eventId));
      if (!core) return;
      await this.notifications.notify(
        [String(e.payload.userId)],
        'waitlist_offer',
        {
          title: core.title,
          eventId: core.id,
          until: { at: String(e.payload.expiresAt) },
        },
        { collapseKey: `offer-${core.id}` },
      );
    });
    bus.subscribe(EVENT_COMPLETED_EVENT, 'notify.feedback-ask', async (e) => {
      await this.reminders.askFeedback(e.aggregateId, new Date(e.occurredAt));
    });
  }
}
