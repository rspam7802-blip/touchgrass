import { Inject, Injectable } from '@nestjs/common';
import type { GeoPoint } from '@touchgrass/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../../infra/database/database.module.js';
import {
  eventHosts,
  eventInterests,
  events,
  eventVibeTags,
  type RefundPolicyJson,
  rsvps,
} from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { REDIS } from '../../infra/redis/redis.module.js';

/**
 * Everything about an event EXCEPT its exact location. This is the only shape that is cached or passed
 * around; the exact spot is a separate read used only on the reveal path (F-EVT-12 leak prevention).
 */
export interface EventCore {
  id: string;
  slug: string;
  type: 'curated' | 'plan' | 'crew_session';
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  title: string;
  description: string;
  coverMediaId: string | null;
  categoryInterestId: string | null;
  cityId: string;
  neighbourhoodId: string | null;
  venueId: string | null;
  approxCenter: GeoPoint;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  minGroupSize: number;
  pricePaise: number;
  visibility: 'public' | 'friends_of_friends' | 'invite_only' | 'women_only' | 'balanced';
  balancedMaxSharePct: number | null;
  soloFriendly: boolean;
  smallGroup: boolean;
  mystery: boolean;
  mysteryRevealMinutesBefore: number;
  allowPlusOnes: boolean;
  chatEnabled: boolean;
  refundPolicy: RefundPolicyJson | null;
  indoor: boolean;
  accessibility: { stepFree: boolean; accessibleRestroom: boolean; quietSpace: boolean };
  creatorUserId: string;
  cancelledReason: string | null;
  /** Title or description tripped the text filter: only hosts see it until reviewed (F-SAF-06). */
  held: boolean;
  /** Pinned to the top of the city's feed until then, lower rank first (F-GRW-03). */
  featuredUntil: Date | null;
  featuredRank: number | null;
}

export interface ExactLocation {
  point: GeoPoint;
  address: string;
  placeName: string | null;
}

export interface SeatCounts {
  seats: number;
  waitlisted: number;
  byBucket: Record<'woman' | 'man' | 'other', number>;
}

const CACHE_TTL = 300;
const emptyCounts = (): SeatCounts => ({
  seats: 0,
  waitlisted: 0,
  byBucket: { woman: 0, man: 0, other: 0 },
});
type Cached = Omit<EventCore, 'startsAt' | 'endsAt' | 'featuredUntil'> & {
  startsAt: string;
  endsAt: string;
  featuredUntil: string | null;
};

@Injectable()
export class EventStore {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private coreColumns() {
    return {
      id: events.id,
      slug: events.slug,
      type: events.type,
      status: events.status,
      title: events.title,
      description: events.description,
      coverMediaId: events.coverMediaId,
      categoryInterestId: events.categoryInterestId,
      cityId: events.cityId,
      neighbourhoodId: events.neighbourhoodId,
      venueId: events.venueId,
      approxLat: sql<number>`ST_Y(${events.approxCenter}::geometry)`,
      approxLng: sql<number>`ST_X(${events.approxCenter}::geometry)`,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      capacity: events.capacity,
      minGroupSize: events.minGroupSize,
      pricePaise: events.pricePaise,
      visibility: events.visibility,
      balancedMaxSharePct: events.balancedMaxSharePct,
      soloFriendly: events.soloFriendly,
      smallGroup: events.smallGroup,
      mystery: events.mystery,
      mysteryRevealMinutesBefore: events.mysteryRevealMinutesBefore,
      allowPlusOnes: events.allowPlusOnes,
      chatEnabled: events.chatEnabled,
      refundPolicy: events.refundPolicy,
      indoor: events.indoor,
      accessibility: events.accessibility,
      creatorUserId: events.creatorUserId,
      cancelledReason: events.cancelledReason,
      held: sql<boolean>`${events.heldAt} IS NOT NULL`,
      featuredUntil: events.featuredUntil,
      featuredRank: events.featuredRank,
    };
  }

  private static toCore(
    r: { approxLat: number; approxLng: number } & Omit<EventCore, 'approxCenter'>,
  ): EventCore {
    const { approxLat, approxLng, ...rest } = r;
    return { ...rest, approxCenter: { lat: approxLat, lng: approxLng } };
  }

  async core(
    id: string,
    db: DbOrTx = this.db,
    opts: { lock?: boolean; fresh?: boolean } = {},
  ): Promise<EventCore | null> {
    if (!opts.lock && !opts.fresh && db === this.db) {
      const hit = await this.redis.get(`cache:event:v3:${id}`);
      if (hit) {
        const c = JSON.parse(hit) as Cached;
        return {
          ...c,
          startsAt: new Date(c.startsAt),
          endsAt: new Date(c.endsAt),
          featuredUntil: c.featuredUntil ? new Date(c.featuredUntil) : null,
        };
      }
    }
    const q = db.select(this.coreColumns()).from(events).where(eq(events.id, id)).limit(1);
    const [row] = opts.lock ? await q.for('update', { of: events }) : await q;
    if (!row) return null;
    const core = EventStore.toCore(row);
    if (!opts.lock)
      await this.redis.set(`cache:event:v3:${id}`, JSON.stringify(core), 'EX', CACHE_TTL);
    return core;
  }

  async coresByIds(ids: string[]): Promise<EventCore[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select(this.coreColumns())
      .from(events)
      .where(inArray(events.id, ids));
    return rows.map((r) => EventStore.toCore(r));
  }

  async idBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, slug))
      .limit(1);
    return row?.id ?? null;
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.del(`cache:event:v3:${id}`);
  }

  /** The true spot. Callers must have established the viewer may see it (isLocationRevealed). */
  async exactLocation(id: string): Promise<ExactLocation | null> {
    const [row] = await this.db
      .select({
        lat: sql<number>`ST_Y(${events.location}::geometry)`,
        lng: sql<number>`ST_X(${events.location}::geometry)`,
        address: events.address,
        placeName: events.placeName,
      })
      .from(events)
      .where(eq(events.id, id))
      .limit(1);
    return row
      ? { point: { lat: row.lat, lng: row.lng }, address: row.address, placeName: row.placeName }
      : null;
  }

  /** Whether a point is within `meters` of the true spot, computed in PostGIS without returning the spot. */
  async within(id: string, point: GeoPoint, meters: number): Promise<boolean> {
    const res = await this.db.execute<{ ok: boolean }>(sql`
      SELECT ST_DWithin(location, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography, ${meters}) AS ok FROM events WHERE id = ${id}`);
    return res.rows[0]?.ok === true;
  }

  async hosts(
    eventId: string,
    db: DbOrTx = this.db,
  ): Promise<{ userId: string; role: 'host' | 'co_host' | 'welcome_host' }[]> {
    return db
      .select({ userId: eventHosts.userId, role: eventHosts.role })
      .from(eventHosts)
      .where(eq(eventHosts.eventId, eventId));
  }

  async seatCounts(eventId: string, db: DbOrTx = this.db): Promise<SeatCounts> {
    return (await this.seatCountsMany([eventId], db)).get(eventId) ?? emptyCounts();
  }

  async seatCountsMany(eventIds: string[], db: DbOrTx = this.db): Promise<Map<string, SeatCounts>> {
    const out = new Map<string, SeatCounts>(eventIds.map((id) => [id, emptyCounts()]));
    if (eventIds.length === 0) return out;
    const rows = await db
      .select({
        eventId: rsvps.eventId,
        status: rsvps.status,
        bucket: rsvps.genderBucket,
        n: sql<number>`count(*)::int`,
        guests: sql<number>`coalesce(sum(${rsvps.guestSeats}), 0)::int`,
      })
      .from(rsvps)
      .where(
        and(
          inArray(rsvps.eventId, eventIds),
          // A seat held during checkout is taken (F-PAY-01).
          inArray(rsvps.status, ['going', 'checked_in', 'waitlisted', 'held']),
        ),
      )
      .groupBy(rsvps.eventId, rsvps.status, rsvps.genderBucket);
    for (const r of rows) {
      const c = out.get(r.eventId) ?? emptyCounts();
      if (r.status === 'waitlisted') c.waitlisted += r.n;
      else {
        c.seats += r.n + r.guests;
        c.byBucket[r.bucket] += r.n;
        // Unclaimed guest seats have no verified gender yet.
        c.byBucket.other += r.guests;
      }
      out.set(r.eventId, c);
    }
    return out;
  }

  /** Exact spots for events the caller has already established are revealed to the viewer. */
  async exactLocations(eventIds: string[]): Promise<Map<string, ExactLocation>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: events.id,
        lat: sql<number>`ST_Y(${events.location}::geometry)`,
        lng: sql<number>`ST_X(${events.location}::geometry)`,
        address: events.address,
        placeName: events.placeName,
      })
      .from(events)
      .where(inArray(events.id, eventIds));
    return new Map(
      rows.map((r) => [
        r.id,
        { point: { lat: r.lat, lng: r.lng }, address: r.address, placeName: r.placeName },
      ]),
    );
  }

  async taxonomy(eventId: string): Promise<{ interestIds: string[]; vibeTagIds: string[] }> {
    const [i, v] = await Promise.all([
      this.db
        .select({ id: eventInterests.interestId })
        .from(eventInterests)
        .where(eq(eventInterests.eventId, eventId)),
      this.db
        .select({ id: eventVibeTags.vibeTagId })
        .from(eventVibeTags)
        .where(eq(eventVibeTags.eventId, eventId)),
    ]);
    return { interestIds: i.map((r) => r.id), vibeTagIds: v.map((r) => r.id) };
  }

  /** People holding a seat (going or checked in), with how they came. */
  async seatHolders(
    eventId: string,
    db: DbOrTx = this.db,
  ): Promise<
    {
      userId: string;
      plusOneOf: string | null;
      guestSeats: number;
      status: 'going' | 'checked_in';
    }[]
  > {
    const rows = await db
      .select({
        userId: rsvps.userId,
        plusOneOf: rsvps.plusOneOf,
        guestSeats: rsvps.guestSeats,
        status: rsvps.status,
      })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), inArray(rsvps.status, ['going', 'checked_in'])));
    return rows.map((r) => ({ ...r, status: r.status === 'checked_in' ? 'checked_in' : 'going' }));
  }
}
