import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYTICS_METRICS,
  type AnalyticsMetric,
  type AnalyticsOverview,
  LOCALE_DEFAULTS,
  zonedParts,
} from '@touchgrass/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { type CityScope } from '../../common/auth/admin-scope.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { analyticsActive, analyticsDaily, NO_CITY } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import type { DomainEventJob } from '../../worker/domain-event-bus.js';
import { CitiesService } from '../cities/cities.service.js';
import { EventStore } from '../events/event-store.service.js';
import { UsersService } from '../users/users.service.js';
import { actorOf } from './analytics.service.js';

/** Domain event → overview counter (F-WEB-03 analytics overview). */
export const COUNTED_EVENTS: Record<string, AnalyticsMetric> = {
  'user.signed_up': 'signed_up',
  'user.onboarded': 'onboarded',
  'event.created': 'plan_created',
  'rsvp.going': 'pulled_up',
  'rsvp.checked_in': 'checked_in',
  'payment.captured': 'payment_captured',
  'report.created': 'report_created',
  'city.waitlist_joined': 'city_waitlist_joined',
};

const SEEN_TTL_SECONDS = 7 * 24 * 3600;

export function dayIn(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.year)}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The admin analytics overview's read model: per city, per local day counters and the set of people
 * active that day, fed from domain events (no other module's tables are queried). Deliveries are
 * at-least-once, so each outbox event is counted once (Redis marker per event id).
 */
@Injectable()
export class AnalyticsCountersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly cities: CitiesService,
    private readonly events: EventStore,
    private readonly users: UsersService,
  ) {}

  /** The city an action belongs to: the payload's, the plan's, else the actor's home city. */
  private async cityOf(e: DomainEventJob, actor: string | null): Promise<string | null> {
    const fromPayload = e.payload.cityId;
    if (typeof fromPayload === 'string') return fromPayload;
    const eventId = e.payload.eventId ?? (e.aggregateType === 'event' ? e.aggregateId : undefined);
    if (typeof eventId === 'string') {
      const core = await this.events.core(eventId);
      if (core) return core.cityId;
    }
    if (actor) return (await this.users.findById(actor))?.cityId ?? null;
    return null;
  }

  async record(e: DomainEventJob): Promise<boolean> {
    const metric = COUNTED_EVENTS[e.type];
    const actor = actorOf(e);
    if (!metric && !actor) return false;
    const fresh = await this.redis.set(
      `analytics:seen:${e.eventId}`,
      '1',
      'EX',
      SEEN_TTL_SECONDS,
      'NX',
    );
    if (fresh === null) return false;
    const cityId = await this.cityOf(e, actor);
    const zone = cityId
      ? ((await this.cities.timezones([cityId])).get(cityId) ?? LOCALE_DEFAULTS.timezone)
      : LOCALE_DEFAULTS.timezone;
    const day = dayIn(new Date(e.occurredAt), zone);
    const city = cityId ?? NO_CITY;
    const bump = async (m: AnalyticsMetric, by: number): Promise<void> => {
      await this.db
        .insert(analyticsDaily)
        .values({ day, cityId: city, metric: m, value: by })
        .onConflictDoUpdate({
          target: [analyticsDaily.day, analyticsDaily.cityId, analyticsDaily.metric],
          set: { value: sql`${analyticsDaily.value} + ${by}` },
        });
    };
    if (metric) await bump(metric, 1);
    if (metric === 'payment_captured' && typeof e.payload.amountPaise === 'number')
      await bump('revenue_paise', e.payload.amountPaise);
    if (actor)
      await this.db
        .insert(analyticsActive)
        .values({ day, userId: actor, cityId: city })
        .onConflictDoNothing();
    return true;
  }

  async overview(
    cityId: string | null,
    days: number,
    scope: CityScope,
    now: Date = new Date(),
  ): Promise<AnalyticsOverview> {
    const cities: string[] | null = cityId ? [cityId] : scope === 'all' ? null : [...scope];
    const today = dayIn(now, LOCALE_DEFAULTS.timezone);
    const from = new Date(`${today}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const fromDay = from.toISOString().slice(0, 10);
    const cityFilter = (col: typeof analyticsDaily.cityId | typeof analyticsActive.cityId) =>
      cities === null ? undefined : cities.length === 0 ? sql`false` : inArray(col, cities);
    const [counters, activeByDay, activeTotal] = await Promise.all([
      this.db
        .select({
          day: analyticsDaily.day,
          metric: analyticsDaily.metric,
          value: sql<number>`sum(${analyticsDaily.value})::bigint::int`,
        })
        .from(analyticsDaily)
        .where(and(gte(analyticsDaily.day, fromDay), cityFilter(analyticsDaily.cityId)))
        .groupBy(analyticsDaily.day, analyticsDaily.metric),
      this.db
        .select({ day: analyticsActive.day, n: sql<number>`count(*)::int` })
        .from(analyticsActive)
        .where(and(gte(analyticsActive.day, fromDay), cityFilter(analyticsActive.cityId)))
        .groupBy(analyticsActive.day),
      this.db
        .select({ n: sql<number>`count(DISTINCT ${analyticsActive.userId})::int` })
        .from(analyticsActive)
        .where(and(gte(analyticsActive.day, fromDay), cityFilter(analyticsActive.cityId))),
    ]);
    const totals = Object.fromEntries(ANALYTICS_METRICS.map((m) => [m, 0])) as Record<
      AnalyticsMetric,
      number
    >;
    for (const c of counters)
      if ((ANALYTICS_METRICS as readonly string[]).includes(c.metric))
        totals[c.metric as AnalyticsMetric] += c.value;
    const daily = Array.from({ length: days }, (_, i) => {
      const d = new Date(from);
      d.setUTCDate(from.getUTCDate() + i);
      const day = d.toISOString().slice(0, 10);
      const pick = (m: AnalyticsMetric) =>
        counters.filter((c) => c.day === day && c.metric === m).reduce((a, c) => a + c.value, 0);
      return {
        day,
        signedUp: pick('signed_up'),
        pulledUp: pick('pulled_up'),
        checkedIn: pick('checked_in'),
        active: activeByDay.find((a) => a.day === day)?.n ?? 0,
      };
    });
    return {
      cityId,
      days,
      totals,
      activeUsers: activeTotal[0]?.n ?? 0,
      showUpRate: totals.pulled_up > 0 ? Math.min(1, totals.checked_in / totals.pulled_up) : null,
      daily,
    };
  }

  /** Active-people rows are per person: keep 90 days for the longest period the overview shows. */
  async pruneActive(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 91 * 24 * 3600_000).toISOString().slice(0, 10);
    const rows = await this.db
      .delete(analyticsActive)
      .where(sql`${analyticsActive.day} < ${cutoff}`)
      .returning({ day: analyticsActive.day });
    return rows.length;
  }

  /** Erasure: the person's activity rows go; counters were never personal. */
  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx.delete(analyticsActive).where(eq(analyticsActive.userId, userId));
  }
}
