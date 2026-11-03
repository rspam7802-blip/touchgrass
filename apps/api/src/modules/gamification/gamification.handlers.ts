import { Injectable } from '@nestjs/common';
import { isQuietHours, LocalizedText } from '@touchgrass/shared';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { RECONNECT_MUTUAL_EVENT } from '../after/after.service.js';
import { CrewsService } from '../crews/crews.service.js';
import { RSVP_CHECKED_IN_EVENT } from '../events/check-in.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { EVENT_COMPLETED_EVENT } from '../events/events.service.js';
import { LORE_ADDED_EVENT } from '../lore/lore.service.js';
import { REFERRAL_REWARDED_EVENT } from '../referrals/referral-codes.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CHALLENGE_COMPLETED_EVENT, ChallengesService } from './challenges.service.js';
import { ActivityService } from '../social/activity/activity.service.js';
import { BADGE_EARNED_EVENT, GamificationService } from './gamification.service.js';
import { RECAP_READY_EVENT, RecapsService } from './recaps.service.js';

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * Worker: turns domain events into gamification facts (check-ins, hosted plans, reconnects, Lore photos,
 * crew sessions, referrals), then refreshes streaks, challenges and badges, and sends the pushes.
 */
@Injectable()
export class GamificationHandlers {
  constructor(
    private readonly gamification: GamificationService,
    private readonly challenges: ChallengesService,
    private readonly recaps: RecapsService,
    private readonly store: EventStore,
    private readonly search: EventSearchService,
    private readonly crews: CrewsService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(RSVP_CHECKED_IN_EVENT, 'gamification.check-in', async (e) => {
      await this.onCheckIn(
        String(e.payload.userId),
        typeof e.payload.eventId === 'string' ? e.payload.eventId : e.aggregateId,
        e.payload.onTime === true,
        new Date(e.occurredAt),
      );
    });
    bus.subscribe(EVENT_COMPLETED_EVENT, 'gamification.hosted', async (e) => {
      await this.onCompleted(e.aggregateId, new Date(e.occurredAt));
    });
    bus.subscribe(LORE_ADDED_EVENT, 'gamification.lore-photo', async (e) => {
      const userId = String(e.payload.uploaderId);
      await this.gamification.recordFact({
        userId,
        kind: 'lore_photo',
        ref: String(e.payload.itemId),
        at: new Date(e.occurredAt),
        attrs: { eventId: e.aggregateId },
      });
      await this.gamification.evaluate(userId, e.aggregateId);
    });
    bus.subscribe(RECONNECT_MUTUAL_EVENT, 'gamification.reconnect', async (e) => {
      const [a, b] = ids(e.payload.userIds);
      if (!a || !b) return;
      for (const [me, other] of [
        [a, b],
        [b, a],
      ] as const) {
        await this.gamification.recordFact({
          userId: me,
          kind: 'reconnect',
          ref: `${e.aggregateId}:${other}`,
          at: new Date(e.occurredAt),
          attrs: { eventId: e.aggregateId, otherUserId: other },
        });
        await this.gamification.evaluate(me, e.aggregateId);
      }
    });
    bus.subscribe(REFERRAL_REWARDED_EVENT, 'gamification.referral', async (e) => {
      const referrerId = String(e.payload.referrerId);
      await this.gamification.recordFact({
        userId: referrerId,
        kind: 'referral',
        ref: String(e.payload.refereeId),
        at: new Date(e.occurredAt),
        attrs: { otherUserId: String(e.payload.refereeId) },
      });
      await this.gamification.evaluate(referrerId, null);
    });
    bus.subscribe(BADGE_EARNED_EVENT, 'gamification.push-badge', async (e) => {
      const badge = await this.gamification.badgeById(String(e.payload.badgeId));
      if (!badge) return;
      await this.notifications.notify([String(e.payload.userId)], 'badge_earned', {
        emoji: badge.emoji,
        name: badge.name,
      });
    });
    // Squad activity (F-SOC-04): "Priya earned 🌱 Grass Toucher".
    bus.subscribe(BADGE_EARNED_EVENT, 'activity.badge_earned', async (e) => {
      const userId = String(e.payload.userId);
      await this.activity.record({
        sourceEventId: e.eventId,
        actorId: userId,
        verb: 'badge_earned',
        objectType: 'badge',
        objectId: String(e.payload.badgeId),
      });
    });
    bus.subscribe(CHALLENGE_COMPLETED_EVENT, 'gamification.push-challenge', async (e) => {
      const title = await this.challenges.titleOf(e.aggregateId);
      if (!title) return;
      await this.notifications.notify(ids(e.payload.userIds), 'challenge_completed', {
        title: LocalizedText.parse(title),
      });
    });
    bus.subscribe(RECAP_READY_EVENT, 'gamification.push-recap', async (e) => {
      const recapId = String(e.payload.recapId);
      await this.notifications.notify([String(e.payload.userId)], 'recap_ready', { recapId });
      await this.recaps.markNotified(recapId);
    });
  }

  /**
   * Saturday evening: a gentle "streak at risk" push to people whose streak isn't covered this week yet,
   * once per week and never in quiet hours (22:00–08:00 IST).
   */
  async remindStreaks(now: Date = new Date()): Promise<number> {
    if (isQuietHours(now)) return 0;
    const due = await this.gamification.atRisk(now);
    let sent = 0;
    for (const d of due) {
      const r = await this.notifications.notify(
        [d.userId],
        'streak_risk',
        { count: d.current },
        { collapseKey: 'streak', now },
      );
      sent += r.pushed + r.deferred;
    }
    await this.gamification.markReminded(
      due.map((d) => d.userId),
      now,
    );
    return sent;
  }

  async onCheckIn(userId: string, eventId: string, onTime: boolean, at: Date): Promise<void> {
    const core = await this.store.core(eventId);
    if (!core) return;
    const [taxonomy, crew] = await Promise.all([
      this.store.taxonomy(eventId),
      core.type === 'crew_session' ? this.crews.crewOfEvent(eventId) : Promise.resolve(null),
    ]);
    await this.gamification.recordFact({
      userId,
      kind: 'check_in',
      ref: eventId,
      at,
      attrs: {
        eventId,
        venueId: core.venueId,
        neighbourhoodId: core.neighbourhoodId,
        categoryId: core.categoryInterestId,
        crewId: crew?.id ?? null,
        vibeTagIds: taxonomy.vibeTagIds,
        onTime,
      },
    });
    if (crew)
      await this.gamification.recordFact({
        userId,
        kind: 'crew_session',
        ref: eventId,
        at,
        attrs: { eventId, crewId: crew.id },
      });
    await this.gamification.refreshStreak(userId, at);
    await this.challenges.onCheckIn(userId, at);
    await this.gamification.evaluate(userId, eventId, at);
  }

  /** A finished plan someone (besides the hosts) checked in to counts as hosted for its primary host. */
  async onCompleted(eventId: string, at: Date): Promise<void> {
    const [core, outcomes, hosts] = await Promise.all([
      this.store.core(eventId),
      this.search.seatOutcomes(eventId),
      this.store.hosts(eventId),
    ]);
    if (!core || !outcomes.some((o) => o.checkedIn)) return;
    const host = hosts.find((h) => h.role === 'host')?.userId ?? core.creatorUserId;
    await this.gamification.recordFact({
      userId: host,
      kind: 'hosted',
      ref: eventId,
      at,
      attrs: { eventId },
    });
    await this.gamification.evaluate(host, eventId, at);
  }
}
