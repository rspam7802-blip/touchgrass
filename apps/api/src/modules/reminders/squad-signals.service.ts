import { Injectable } from '@nestjs/common';
import { LIMITS } from '@touchgrass/shared';
import { canViewEvent } from '../events/event.policy.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { RemindersService } from './reminders.service.js';
import {
  bucketRef,
  planIsNudgeable,
  shouldNudgeOutside,
  shouldNudgePullingUp,
  squadOutsideCount,
  squadPullingUpCount,
} from './squad-signals.policy.js';

const N = LIMITS.notifications;
/** Bounds the work one RSVP or check-in can cause. */
const MAX_AUDIENCE = 300;
const HOUR_MS = 3_600_000;

/**
 * Social-proof notifications from the brand notes (Phase 13): "3 of your squad are pulling up" and "Your squad is
 * outside. Are you?". Only people who share their activity are counted, only plans the reader may see are named,
 * and `reminder_log` keeps each to once per plan (pulling up), once per hour (pulling up, any plan) and once per day
 * (outside).
 */
@Injectable()
export class SquadSignalsService {
  constructor(
    private readonly store: EventStore,
    private readonly search: EventSearchService,
    private readonly access: EventAccessService,
    private readonly graph: SocialGraphService,
    private readonly profiles: ProfilesService,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** After `actorId` pulls up to `eventId`: tells their squad members who now have 3+ of their squad going. */
  async afterPullUp(eventId: string, actorId: string, now: Date = new Date()): Promise<number> {
    const [core] = await this.store.coresByIds([eventId]);
    if (!core || !planIsNudgeable(core, now)) return 0;
    if (!(await this.profiles.withPrivacyFlag([actorId], 'shareActivity')).has(actorId)) return 0;
    const seats = (await this.search.seatHoldersMany([eventId])).get(eventId) ?? [];
    const sharing = await this.profiles.withPrivacyFlag(seats, 'shareActivity');
    const seatSet = new Set(seats);
    const audience = (await this.graph.friendIds(actorId)).slice(0, MAX_AUDIENCE);
    const due: { userId: string; count: number }[] = [];
    for (const viewerId of audience) {
      const ctx = await this.access.context(viewerId);
      const count = squadPullingUpCount({
        viewerId,
        viewerSquad: ctx.squad,
        sharingSeatHolders: [...sharing],
      });
      if (!shouldNudgePullingUp(count, seatSet.has(viewerId))) continue;
      const facts = (await this.access.factsFor(ctx, [eventId])).get(eventId);
      if (!facts || !canViewEvent(facts, core)) continue;
      due.push({ userId: viewerId, count });
    }
    if (due.length === 0) return 0;
    // Once per plan, then at most once an hour across plans.
    const perPlan = new Set(
      await this.reminders.claim(
        due.map((d) => d.userId),
        eventId,
        'squad_pulling_up',
        now,
      ),
    );
    const hour = Math.floor(now.getTime() / HOUR_MS);
    const perHour = new Set(
      await this.reminders.claim(
        [...perPlan],
        bucketRef(`squad-pulling-up:${String(hour)}`),
        'squad_pulling_up_hour',
        now,
      ),
    );
    let sent = 0;
    const when = await this.reminders.when(core);
    for (const d of due) {
      if (!perHour.has(d.userId)) continue;
      await this.notifications.notify(
        [d.userId],
        'squad_pulling_up',
        { count: d.count, title: core.title, eventId, when },
        { collapseKey: `squad-going-${eventId}`, now },
      );
      sent += 1;
    }
    return sent;
  }

  /** After `actorId` checks in: tells squad members with 2+ of their squad checked in lately (once a day). */
  async afterCheckIn(actorId: string, now: Date = new Date()): Promise<number> {
    if (!(await this.profiles.withPrivacyFlag([actorId], 'shareActivity')).has(actorId)) return 0;
    const since = new Date(now.getTime() - N.squadOutsideWindowMs);
    const audience = (await this.graph.friendIds(actorId)).slice(0, MAX_AUDIENCE);
    const due: { userId: string; count: number }[] = [];
    for (const viewerId of audience) {
      const squad = await this.graph.friendIds(viewerId);
      const out = await this.search.checkedInSince([...squad, viewerId], since);
      const sharing = await this.profiles.withPrivacyFlag([...out], 'shareActivity');
      const count = squadOutsideCount({
        viewerId,
        viewerSquad: new Set(squad),
        sharingRecentlyCheckedIn: [...sharing],
      });
      if (shouldNudgeOutside(count, out.has(viewerId))) due.push({ userId: viewerId, count });
    }
    if (due.length === 0) return 0;
    const day = now.toISOString().slice(0, 10);
    const claimed = new Set(
      await this.reminders.claim(
        due.map((d) => d.userId),
        bucketRef(`squad-outside:${day}`),
        'squad_outside',
        now,
      ),
    );
    let sent = 0;
    for (const d of due) {
      if (!claimed.has(d.userId)) continue;
      await this.notifications.notify([d.userId], 'squad_outside', { count: d.count }, { now });
      sent += 1;
    }
    return sent;
  }
}
