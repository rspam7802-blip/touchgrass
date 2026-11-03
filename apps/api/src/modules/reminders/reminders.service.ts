import { Inject, Injectable } from '@nestjs/common';
import { LIMITS, LOCALE_DEFAULTS, type NotificationKind } from '@touchgrass/shared';
import { lt } from 'drizzle-orm';
import { DB, type Database } from '../../infra/database/database.module.js';
import { reminderLog } from '../../infra/database/schema/index.js';
import { EventSearchService } from '../events/event-search.service.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { CitiesService } from '../cities/cities.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const N = LIMITS.notifications;
const LOG_RETENTION_MS = 30 * 24 * 3_600_000;
/** How far back the reveal job looks, so a missed tick (deploy, outage) still sends. */
const REVEAL_LOOKBACK_MS = 6 * 3_600_000;

/**
 * Time-based reminders (F-NOT-02). Jobs can run as often as they like: `reminder_log` records each
 * (person, thing, kind) once, so nobody hears the same reminder twice.
 */
@Injectable()
export class RemindersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly search: EventSearchService,
    private readonly store: EventStore,
    private readonly notifications: NotificationsService,
    private readonly cities: CitiesService,
  ) {}

  /** A plan's start as a notification moment, shown in the plan's city time zone (F-GRW-03). */
  async when(core: Pick<EventCore, 'startsAt' | 'cityId'>): Promise<{ at: string; tz: string }> {
    const tz =
      (await this.cities.timezones([core.cityId])).get(core.cityId) ?? LOCALE_DEFAULTS.timezone;
    return { at: core.startsAt.toISOString(), tz };
  }

  /** Claims (person, ref, kind) rows; returns only the people who hadn't had this reminder yet. */
  async claim(userIds: string[], refId: string, kind: string, now: Date): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .insert(reminderLog)
      .values(userIds.map((userId) => ({ userId, refId, kind, sentAt: now })))
      .onConflictDoNothing()
      .returning({ userId: reminderLog.userId });
    return rows.map((r) => r.userId);
  }

  private async remindSeats(
    cores: EventCore[],
    kind: NotificationKind,
    now: Date,
  ): Promise<number> {
    const live = cores.filter((c) => c.status === 'published' && !c.held);
    const seats = await this.search.seatHoldersMany(live.map((c) => c.id));
    let sent = 0;
    for (const c of live) {
      const to = await this.claim(seats.get(c.id) ?? [], c.id, kind, now);
      if (to.length === 0) continue;
      await this.notifications.notify(
        to,
        kind,
        { title: c.title, eventId: c.id, when: await this.when(c) },
        { collapseKey: `plan-${c.id}`, now },
      );
      sent += to.length;
    }
    return sent;
  }

  /**
   * Every 5 minutes: "coming up" a day ahead (the group chat opens then too) and "starts soon" two hours
   * ahead, to everyone holding a seat. Someone who joins inside a window gets that window's reminder.
   */
  async remindPlans(now: Date = new Date()): Promise<number> {
    const t = now.getTime();
    const [dayIds, soonIds] = await Promise.all([
      this.search.startingBetween(new Date(t + N.reminderShortMs), new Date(t + N.reminderLongMs)),
      this.search.startingBetween(now, new Date(t + N.reminderShortMs)),
    ]);
    const [day, soon] = await Promise.all([
      this.store.coresByIds(dayIds),
      this.store.coresByIds(soonIds),
    ]);
    return (
      (await this.remindSeats(day, 'reminder_day', now)) +
      (await this.remindSeats(soon, 'reminder_soon', now))
    );
  }

  /** Every 5 minutes: mystery spots revealed since the last run. */
  async announceReveals(now: Date = new Date()): Promise<number> {
    const ids = await this.search.mysteryRevealsBetween(
      new Date(now.getTime() - REVEAL_LOOKBACK_MS),
      now,
    );
    return this.remindSeats(await this.store.coresByIds(ids), 'mystery_revealed', now);
  }

  /** After a plan completes: "How was it?" to everyone who checked in. */
  async askFeedback(eventId: string, now: Date = new Date()): Promise<number> {
    const [core] = await this.store.coresByIds([eventId]);
    if (!core) return 0;
    const outcomes = await this.search.seatOutcomes(eventId);
    const to = await this.claim(
      outcomes.filter((o) => o.checkedIn).map((o) => o.userId),
      eventId,
      'feedback_ask',
      now,
    );
    if (to.length === 0) return 0;
    await this.notifications.notify(to, 'feedback_ask', { title: core.title, eventId }, { now });
    return to.length;
  }

  /** Daily: the log only needs to outlive the things it guards. */
  async prune(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .delete(reminderLog)
      .where(lt(reminderLog.sentAt, new Date(now.getTime() - LOG_RETENTION_MS)))
      .returning({ refId: reminderLog.refId });
    return rows.length;
  }
}
