import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminEventDetail,
  type AdminEventPage,
  type AdminEventQuery,
  type AdminEventRow,
  type CustomerPlanRsvp,
  type CustomerPlanStats,
  decodeCursor,
  encodeCursor,
  type FeatureEventBody,
  TimeIdCursor,
} from '@touchgrass/shared';
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { type CityScope, inScope } from '../../common/auth/admin-scope.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { eventHosts, events, rsvps } from '../../infra/database/schema/index.js';
import { CitiesService } from '../cities/cities.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { EventStore } from './event-store.service.js';
import { EventsService } from './events.service.js';

const LIKE_ESCAPE = /[\\%_]/g;

/**
 * The admin dashboard's events section (F-WEB-03): every plan in the caller's cities, featuring plans at
 * the top of a city's feed, and staff edit / cancel. Lists never select `events.location`.
 */
@Injectable()
export class AdminEventsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly store: EventStore,
    private readonly events: EventsService,
    private readonly cities: CitiesService,
    private readonly profiles: ProfilesService,
    private readonly audit: AuditService,
  ) {}

  async list(
    q: AdminEventQuery,
    scope: CityScope,
    now: Date = new Date(),
  ): Promise<AdminEventPage> {
    if (q.cityId && !inScope(scope, q.cityId)) return { items: [], nextCursor: null };
    if (scope !== 'all' && scope.length === 0) return { items: [], nextCursor: null };
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const where: (SQL | undefined)[] = [
      q.cityId
        ? eq(events.cityId, q.cityId)
        : scope === 'all'
          ? undefined
          : inArray(events.cityId, [...scope]),
      q.status ? eq(events.status, q.status) : undefined,
      q.type ? eq(events.type, q.type) : undefined,
      q.featured === true
        ? and(
            isNotNull(events.featuredUntil),
            gt(events.featuredUntil, now),
            eq(events.status, 'published'),
          )
        : q.featured === false
          ? or(isNull(events.featuredUntil), lt(events.featuredUntil, now))
          : undefined,
      q.q ? ilike(events.title, `%${q.q.replace(LIKE_ESCAPE, (c) => `\\${c}`)}%`) : undefined,
      after
        ? or(
            lt(events.startsAt, new Date(after.t)),
            and(eq(events.startsAt, new Date(after.t)), lt(events.id, after.id)),
          )
        : undefined,
    ];
    const rows = await this.db
      .select({ id: events.id })
      .from(events)
      .where(and(...where))
      .orderBy(desc(events.startsAt), desc(events.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const items = await this.rows(
      page.map((r) => r.id),
      now,
    );
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > q.limit && last ? encodeCursor({ t: last.startsAt, id: last.id }) : null,
    };
  }

  async detail(
    eventId: string,
    scope: CityScope,
    now: Date = new Date(),
  ): Promise<AdminEventDetail> {
    const core = await this.events.requireStaff(eventId, scope);
    const [row] = await this.rows([eventId], now);
    if (!row) throw AppError.notFound('Event');
    return {
      ...row,
      description: core.description,
      endsAt: core.endsAt.toISOString(),
      visibility: core.visibility,
      cancelledReason: core.cancelledReason,
    };
  }

  private async rows(ids: string[], now: Date): Promise<AdminEventRow[]> {
    if (ids.length === 0) return [];
    const cores = (await Promise.all(ids.map((id) => this.store.core(id)))).flatMap((c) =>
      c ? [c] : [],
    );
    const [cityRows, names, counts] = await Promise.all([
      this.cities.list(),
      this.profiles.displayNames([...new Set(cores.map((c) => c.creatorUserId))]),
      this.store.seatCountsMany(ids),
    ]);
    const cityNames = new Map(cityRows.map((c) => [c.id, c.name]));
    return cores.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      type: c.type,
      status: c.status,
      cityId: c.cityId,
      cityName: cityNames.get(c.cityId) ?? '',
      startsAt: c.startsAt.toISOString(),
      hostName: names.get(c.creatorUserId) ?? null,
      going: counts.get(c.id)?.seats ?? 0,
      capacity: c.capacity,
      pricePaise: c.pricePaise,
      held: c.held,
      featured:
        c.status === 'published' &&
        c.featuredUntil &&
        c.featuredRank !== null &&
        c.featuredUntil.getTime() > now.getTime()
          ? { until: c.featuredUntil.toISOString(), rank: c.featuredRank }
          : null,
    }));
  }

  /** Pin a published, upcoming plan to the top of its city's feed until `until` (curators, F-GRW-03). */
  async feature(
    adminUserId: string,
    eventId: string,
    body: FeatureEventBody,
    scope: CityScope,
    now: Date = new Date(),
  ): Promise<void> {
    const core = await this.events.requireStaff(eventId, scope);
    if (core.status !== 'published' || core.held || core.visibility !== 'public')
      throw new AppError('CONFLICT', 'Only published public plans can be featured', {
        reason: 'NOT_FEATURABLE',
      });
    const until = new Date(body.until);
    if (until.getTime() <= now.getTime() || until.getTime() > core.endsAt.getTime())
      throw new AppError('VALIDATION_FAILED', 'Feature until a time before the plan ends', [
        { path: 'until', message: 'Between now and the end of the plan', code: 'custom' },
      ]);
    await this.db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ featuredUntil: until, featuredRank: body.rank, featuredBy: adminUserId })
        .where(eq(events.id, eventId));
      await this.audit.record(
        {
          adminUserId,
          action: 'events.feature',
          targetType: 'event',
          targetId: eventId,
          details: { until: body.until, rank: body.rank, cityId: core.cityId },
        },
        tx,
      );
    });
    await this.store.invalidate(eventId);
  }

  async unfeature(adminUserId: string, eventId: string, scope: CityScope): Promise<void> {
    const core = await this.events.requireStaff(eventId, scope);
    await this.db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ featuredUntil: null, featuredRank: null, featuredBy: null })
        .where(eq(events.id, eventId));
      await this.audit.record(
        {
          adminUserId,
          action: 'events.unfeature',
          targetType: 'event',
          targetId: eventId,
          details: { cityId: core.cityId },
        },
        tx,
      );
    });
    await this.store.invalidate(eventId);
  }

  /** Featured plans per city that are still pinned now, rank order (the feed reads this). */
  async featuredIn(cityIds: string[], now: Date = new Date()): Promise<Map<string, number>> {
    if (cityIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: events.id, rank: events.featuredRank })
      .from(events)
      .where(
        and(
          inArray(events.cityId, cityIds),
          isNotNull(events.featuredUntil),
          gt(events.featuredUntil, now),
          sql`${events.status} = 'published'`,
        ),
      );
    return new Map(rows.flatMap((r) => (r.rank === null ? [] : [[r.id, r.rank] as const])));
  }

  /**
   * Every plan one person pulled up to or hosted, newest first, with their counts (Customer 360, D-192). Plus-one
   * guests are their inviter's seats, so they are left out. No location is read.
   */
  async participation(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ plans: ParticipationRow[]; stats: CustomerPlanStats }> {
    const cols = {
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      status: events.status,
      cityId: events.cityId,
    };
    const [guestRows, hostRows] = await Promise.all([
      this.db
        .select({ e: cols, r: rsvps })
        .from(rsvps)
        .innerJoin(events, eq(events.id, rsvps.eventId))
        .where(and(eq(rsvps.userId, userId), isNull(rsvps.plusOneOf))),
      this.db
        .select({ e: cols, role: eventHosts.role })
        .from(eventHosts)
        .innerJoin(events, eq(events.id, eventHosts.eventId))
        .where(eq(eventHosts.userId, userId)),
    ]);
    const byId = new Map<string, ParticipationRow>();
    for (const { e, r } of guestRows) {
      const ended = e.endsAt <= now && e.status !== 'cancelled' && e.status !== 'draft';
      byId.set(e.id, {
        eventId: e.id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        eventStatus: e.status,
        cityId: e.cityId,
        role: 'guest',
        rsvp: r.status,
        pulledUpAt: r.createdAt,
        checkedInAt: r.checkedInAt,
        cancelledAt: r.cancelledAt,
        lateCancel: r.lateCancel,
        noShow: ended && r.status === 'going',
      });
    }
    for (const { e, role } of hostRows) {
      const guest = byId.get(e.id);
      byId.set(e.id, {
        ...(guest ?? {
          eventId: e.id,
          title: e.title,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          eventStatus: e.status,
          cityId: e.cityId,
          rsvp: null,
          pulledUpAt: null,
          checkedInAt: null,
          cancelledAt: null,
          lateCancel: false,
        }),
        role,
        noShow: false,
      });
    }
    const plans = [...byId.values()].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    const guest = plans.filter((p) => p.role === 'guest');
    const live = (p: ParticipationRow) =>
      p.eventStatus !== 'cancelled' && p.eventStatus !== 'draft';
    return {
      plans,
      stats: {
        pulledUp: guest.filter((p) => p.rsvp === 'going' || p.rsvp === 'checked_in').length,
        checkedIn: guest.filter((p) => p.rsvp === 'checked_in').length,
        upcoming: plans.filter((p) => live(p) && p.endsAt > now && p.rsvp !== 'cancelled').length,
        cancelled: guest.filter((p) => p.rsvp === 'cancelled').length,
        lateCancels: guest.filter((p) => p.lateCancel).length,
        noShows: guest.filter((p) => p.noShow).length,
        hosted: plans.filter((p) => p.role !== 'guest' && p.eventStatus !== 'draft').length,
      },
    };
  }
}

export interface ParticipationRow {
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  eventStatus: AdminEventRow['status'];
  cityId: string;
  role: 'host' | 'co_host' | 'welcome_host' | 'guest';
  rsvp: CustomerPlanRsvp | null;
  pulledUpAt: Date | null;
  checkedInAt: Date | null;
  cancelledAt: Date | null;
  lateCancel: boolean;
  noShow: boolean;
}
