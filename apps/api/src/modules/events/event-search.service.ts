import { Inject, Injectable } from '@nestjs/common';
import type { GeoPoint, RsvpStatus } from '@touchgrass/shared';
import { and, eq, gte, inArray, type SQL, sql } from 'drizzle-orm';
import { DB, DB_REPLICA, type Database } from '../../infra/database/database.module.js';
import { eventInterests, eventVibeTags, rsvps } from '../../infra/database/schema/index.js';
import { uuidArrayLiteral } from '../social/graph/social-graph.service.js';

export interface CandidateViewer {
  userId: string;
  /** Squad plus friends-of-friends: hosts the viewer can reach for friends-of-friends plans. */
  reachableIds: string[];
  squadIds: string[];
  verifiedWoman: boolean;
  verifiedMan: boolean;
}

export interface CandidateFilters {
  from: Date;
  to: Date;
  categoryId?: string;
  interestIds?: string[];
  vibeTagIds?: string[];
  maxPricePaise?: number;
  smallGroup?: boolean;
  soloFriendly?: boolean;
  womenOnly?: boolean;
  squadGoing?: boolean;
  indoor?: boolean;
  stepFree?: boolean;
  accessibleRestroom?: boolean;
  quietSpace?: boolean;
}

export type CandidateArea =
  | { kind: 'radius'; center: GeoPoint; meters: number }
  | {
      kind: 'bbox';
      minLng: number;
      minLat: number;
      maxLng: number;
      maxLat: number;
      center: GeoPoint;
    };

export interface CandidateRow {
  id: string;
  /** Public centre (approximate for mystery plans). Never the exact spot. */
  lat: number;
  lng: number;
  distanceMeters: number;
  startsAt: Date;
  publishedAt: Date | null;
}

/**
 * Read-only discovery queries over the events module's tables (owner: events). Distances and areas use the
 * public `approx_center`, so a mystery plan's true spot can never be inferred from feed or map results
 * (F-EVT-12). Visibility is pre-filtered here for speed and re-checked with `canViewEvent` by the caller.
 */
@Injectable()
export class EventSearchService {
  constructor(
    @Inject(DB_REPLICA) private readonly replica: Database,
    @Inject(DB) private readonly db: Database,
  ) {}

  async candidates(
    viewer: CandidateViewer,
    area: CandidateArea,
    f: CandidateFilters,
    order: 'soonest' | 'nearest',
    limit: number,
  ): Promise<CandidateRow[]> {
    const point = sql`ST_SetSRID(ST_MakePoint(${area.center.lng}, ${area.center.lat}), 4326)::geography`;
    const me = viewer.userId;
    const conds: SQL[] = [
      sql`e.status = 'published'`,
      // Plans starting in the window; when the window starts now, plans already under way count too.
      f.from.getTime() <= Date.now() + 60_000
        ? sql`e.starts_at < ${f.to} AND e.ends_at > ${f.from}`
        : sql`e.starts_at >= ${f.from} AND e.starts_at < ${f.to}`,
      area.kind === 'radius'
        ? sql`ST_DWithin(e.approx_center, ${point}, ${area.meters})`
        : sql`e.approx_center && ST_MakeEnvelope(${area.minLng}, ${area.minLat}, ${area.maxLng}, ${area.maxLat}, 4326)::geography`,
      // Already on it or hosting: those live in "Your plans".
      sql`NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = e.id AND h.user_id = ${me})`,
      sql`NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.user_id = ${me} AND r.status IN ('going','checked_in','waitlisted'))`,
      sql`(
        e.visibility IN ('public','balanced','approval')
        OR (e.visibility = 'women_only' AND ${viewer.verifiedWoman})
        OR (e.visibility = 'men_only' AND ${viewer.verifiedMan})
        OR EXISTS (SELECT 1 FROM event_invites i WHERE i.event_id = e.id AND i.invitee_user_id = ${me})
        OR (e.visibility = 'friends_of_friends' AND EXISTS (
          SELECT 1 FROM event_hosts h WHERE h.event_id = e.id AND h.user_id = ANY(${uuidArrayLiteral(viewer.reachableIds)}::uuid[])))
      )`,
    ];
    if (f.categoryId) conds.push(sql`e.category_interest_id = ${f.categoryId}`);
    if (f.interestIds && f.interestIds.length > 0) {
      const ids = uuidArrayLiteral(f.interestIds);
      conds.push(
        sql`(e.category_interest_id = ANY(${ids}::uuid[]) OR EXISTS (SELECT 1 FROM event_interests ei WHERE ei.event_id = e.id AND ei.interest_id = ANY(${ids}::uuid[])))`,
      );
    }
    if (f.vibeTagIds && f.vibeTagIds.length > 0)
      conds.push(
        sql`EXISTS (SELECT 1 FROM event_vibe_tags ev WHERE ev.event_id = e.id AND ev.vibe_tag_id = ANY(${uuidArrayLiteral(f.vibeTagIds)}::uuid[]))`,
      );
    if (f.maxPricePaise !== undefined) conds.push(sql`e.price_paise <= ${f.maxPricePaise}`);
    if (f.smallGroup) conds.push(sql`e.small_group`);
    if (f.soloFriendly) conds.push(sql`e.solo_friendly`);
    if (f.womenOnly) conds.push(sql`e.visibility = 'women_only'`);
    if (f.indoor) conds.push(sql`e.indoor`);
    if (f.stepFree) conds.push(sql`(e.accessibility->>'stepFree')::boolean`);
    if (f.accessibleRestroom) conds.push(sql`(e.accessibility->>'accessibleRestroom')::boolean`);
    if (f.quietSpace) conds.push(sql`(e.accessibility->>'quietSpace')::boolean`);
    if (f.squadGoing)
      conds.push(
        sql`EXISTS (SELECT 1 FROM rsvps s WHERE s.event_id = e.id AND s.status IN ('going','checked_in') AND s.user_id = ANY(${uuidArrayLiteral(viewer.squadIds)}::uuid[]))`,
      );
    const orderBy =
      order === 'nearest' ? sql`e.approx_center <-> ${point}, e.id` : sql`e.starts_at, e.id`;
    const res = await this.replica.execute<{
      id: string;
      lat: number;
      lng: number;
      distance: number;
      starts_at: Date;
      published_at: Date | null;
    }>(sql`
      SELECT e.id, ST_Y(e.approx_center::geometry) AS lat, ST_X(e.approx_center::geometry) AS lng,
             ST_Distance(e.approx_center, ${point}) AS distance, e.starts_at, e.published_at
      FROM events e
      WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY ${orderBy}
      LIMIT ${limit}`);
    return res.rows.map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      distanceMeters: Math.round(r.distance),
      startsAt: new Date(r.starts_at),
      publishedAt: r.published_at ? new Date(r.published_at) : null,
    }));
  }

  async taxonomyMany(
    eventIds: string[],
  ): Promise<Map<string, { interestIds: string[]; vibeTagIds: string[] }>> {
    const out = new Map(
      eventIds.map((id) => [id, { interestIds: [] as string[], vibeTagIds: [] as string[] }]),
    );
    if (eventIds.length === 0) return out;
    const [i, v] = await Promise.all([
      this.replica
        .select({ e: eventInterests.eventId, id: eventInterests.interestId })
        .from(eventInterests)
        .where(inArray(eventInterests.eventId, eventIds)),
      this.replica
        .select({ e: eventVibeTags.eventId, id: eventVibeTags.vibeTagId })
        .from(eventVibeTags)
        .where(inArray(eventVibeTags.eventId, eventIds)),
    ]);
    for (const r of i) out.get(r.e)?.interestIds.push(r.id);
    for (const r of v) out.get(r.e)?.vibeTagIds.push(r.id);
    return out;
  }

  /** Seat holders per plan, earliest first. */
  /** Which of these people checked in to any plan since `since` ("your squad is outside", Phase 13). */
  async checkedInSince(userIds: string[], since: Date): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.replica
      .selectDistinct({ u: rsvps.userId })
      .from(rsvps)
      .where(
        and(
          inArray(rsvps.userId, userIds),
          eq(rsvps.status, 'checked_in'),
          gte(rsvps.checkedInAt, since),
        ),
      );
    return new Set(rows.map((r) => r.u));
  }

  async seatHoldersMany(eventIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(eventIds.map((id) => [id, []]));
    if (eventIds.length === 0) return out;
    const rows = await this.replica
      .select({ e: rsvps.eventId, u: rsvps.userId })
      .from(rsvps)
      .where(and(inArray(rsvps.eventId, eventIds), inArray(rsvps.status, ['going', 'checked_in'])))
      .orderBy(rsvps.createdAt);
    for (const r of rows) out.get(r.e)?.push(r.u);
    return out;
  }

  /** Whether two people both held a seat at the same plan starting on or after `since` (DM rule, F-CHT-01). */
  async haveSharedPlan(a: string, b: string, since: Date): Promise<boolean> {
    const res = await this.replica.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM rsvps x JOIN rsvps y ON y.event_id = x.event_id
        JOIN events e ON e.id = x.event_id
        WHERE x.user_id = ${a} AND y.user_id = ${b}
          AND x.status IN ('going','checked_in') AND y.status IN ('going','checked_in')
          AND e.status IN ('published','completed') AND e.starts_at >= ${since}
      ) AS ok`);
    return res.rows[0]?.ok === true;
  }

  /** Published plans starting in [from, to) (the event-chat opener). */
  async startingBetween(from: Date, to: Date): Promise<string[]> {
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT id FROM events WHERE status = 'published' AND starts_at >= ${from} AND starts_at < ${to} ORDER BY starts_at`);
    return res.rows.map((r) => r.id);
  }

  /** Published mystery plans whose spot is revealed in [from, to) and that haven't started (F-NOT-02). */
  async mysteryRevealsBetween(from: Date, to: Date): Promise<string[]> {
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT id FROM events
      WHERE status = 'published' AND mystery AND held_at IS NULL
        AND starts_at - make_interval(mins => mystery_reveal_minutes_before) >= ${from}
        AND starts_at - make_interval(mins => mystery_reveal_minutes_before) < ${to}
        AND starts_at > ${to}
      ORDER BY starts_at`);
    return res.rows.map((r) => r.id);
  }

  /**
   * Who held a seat when a plan finished (F-SAF-02): checked in, or a no-show. Hosts and +1 guests without an
   * account are left out. `at` is the check-in time, or the plan's start for no-shows.
   */
  async seatOutcomes(eventId: string): Promise<{ userId: string; checkedIn: boolean; at: Date }[]> {
    // Called after `event.completed`; RSVPs settled hours earlier, so the replica is current enough.
    const res = await this.replica.execute<{
      user_id: string;
      checked_in: boolean;
      at: string | Date;
    }>(sql`
      SELECT r.user_id, r.status = 'checked_in' AS checked_in, coalesce(r.checked_in_at, e.starts_at) AS at
      FROM rsvps r JOIN events e ON e.id = r.event_id
      WHERE r.event_id = ${eventId} AND r.status IN ('going', 'checked_in')
        AND NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = r.event_id AND h.user_id = r.user_id)`);
    return res.rows.map((r) => ({
      userId: r.user_id,
      checkedIn: r.checked_in,
      at: new Date(r.at),
    }));
  }

  /** Plans someone checked in to that ended in [since, now), newest first (post-event screen, F-AFT-01). */
  async recentlyAttended(userId: string, since: Date, now: Date, limit: number): Promise<string[]> {
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT e.id FROM rsvps r JOIN events e ON e.id = r.event_id
      WHERE r.user_id = ${userId} AND r.status = 'checked_in'
        AND e.status IN ('published', 'completed') AND e.ends_at >= ${since} AND e.ends_at < ${now}
      ORDER BY e.ends_at DESC LIMIT ${limit}`);
    return res.rows.map((r) => r.id);
  }

  /** Crew history (F-ENG-02): how many of these plans each person checked in to. */
  async attendanceCounts(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const res = await this.replica.execute<{ user_id: string; n: number }>(sql`
      SELECT user_id, count(*)::int AS n FROM rsvps
      WHERE event_id = ANY(${uuidArrayLiteral(eventIds)}::uuid[]) AND status = 'checked_in'
      GROUP BY user_id`);
    return new Map(res.rows.map((r) => [r.user_id, r.n]));
  }

  /** Check-ins per plan. */
  async checkedInCounts(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const res = await this.replica.execute<{ event_id: string; n: number }>(sql`
      SELECT event_id, count(*)::int AS n FROM rsvps
      WHERE event_id = ANY(${uuidArrayLiteral(eventIds)}::uuid[]) AND status = 'checked_in'
      GROUP BY event_id`);
    return new Map(res.rows.map((r) => [r.event_id, r.n]));
  }

  /** One person's RSVP status on each of these plans. */
  async rsvpStatuses(userId: string, eventIds: string[]): Promise<Map<string, RsvpStatus>> {
    if (eventIds.length === 0) return new Map();
    const res = await this.db.execute<{ event_id: string; status: RsvpStatus }>(sql`
      SELECT event_id, status FROM rsvps
      WHERE user_id = ${userId} AND event_id = ANY(${uuidArrayLiteral(eventIds)}::uuid[])`);
    return new Map(res.rows.map((r) => [r.event_id, r.status]));
  }

  /** People who were at a plan: checked in, plus its hosts (Lore audience, F-AFT-04). */
  async checkedInAndHosts(eventId: string): Promise<string[]> {
    const res = await this.replica.execute<{ user_id: string }>(sql`
      SELECT user_id FROM rsvps WHERE event_id = ${eventId} AND status = 'checked_in'
      UNION SELECT user_id FROM event_hosts WHERE event_id = ${eventId}`);
    return res.rows.map((r) => r.user_id);
  }

  /** Completed paid plans that ended in [after, before) (payout candidates, F-PAY-03). */
  async completedPaidEndedBetween(after: Date, before: Date): Promise<string[]> {
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT id FROM events
      WHERE status = 'completed' AND price_paise > 0 AND ends_at >= ${after} AND ends_at < ${before}
      ORDER BY ends_at`);
    return res.rows.map((r) => r.id);
  }

  /**
   * Plans overlapping `eventId` in time whose spots are within `meters` (find-your-group colours must differ
   * between groups that could meet). Uses the exact spot server-side only; nothing about it is returned.
   */
  async overlappingNearby(eventId: string, meters: number): Promise<string[]> {
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT o.id FROM events e JOIN events o
        ON o.id <> e.id AND o.status IN ('published', 'completed')
       AND o.starts_at < e.ends_at AND o.ends_at > e.starts_at
       AND ST_DWithin(o.location, e.location, ${meters})
      WHERE e.id = ${eventId}`);
    return res.rows.map((r) => r.id);
  }

  /** Full-text + trigram title search over upcoming published plans (F-DSC-09). Visibility is the caller's job. */
  async searchText(q: string, limit: number, now: Date = new Date()): Promise<string[]> {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT e.id FROM events e
      WHERE e.status = 'published' AND e.ends_at > ${now}
        AND (e.search_document @@ plainto_tsquery('simple', ${q}) OR e.title % ${q} OR e.title ILIKE ${like})
      ORDER BY ts_rank(e.search_document, plainto_tsquery('simple', ${q})) + similarity(e.title, ${q}) DESC, e.starts_at
      LIMIT ${limit}`);
    return res.rows.map((r) => r.id);
  }

  /** How many plans use each interest (as category or tag) / vibe tag (admin taxonomy usage). */
  async taxonomyUsage(): Promise<Map<string, number>> {
    const res = await this.db.execute<{ id: string; n: number }>(sql`
      SELECT id, sum(n)::int AS n FROM (
        SELECT interest_id AS id, count(*) AS n FROM event_interests GROUP BY interest_id
        UNION ALL
        SELECT category_interest_id AS id, count(*) AS n FROM events WHERE category_interest_id IS NOT NULL GROUP BY category_interest_id
        UNION ALL
        SELECT vibe_tag_id AS id, count(*) AS n FROM event_vibe_tags GROUP BY vibe_tag_id
      ) u GROUP BY id`);
    return new Map(res.rows.map((r) => [r.id, r.n]));
  }
}
