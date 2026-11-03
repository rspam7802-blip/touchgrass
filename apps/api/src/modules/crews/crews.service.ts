import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateCrewBody,
  CreateEventBody,
  type CrewDetail,
  type CrewHistory,
  type CrewList,
  type CrewListQuery,
  type CrewMember,
  type CrewMemberActionBody,
  type CrewMembershipBody,
  type CrewRecurrence,
  type CrewRecurrenceBody,
  type CrewSession,
  type CrewSummary,
  decodeCursor,
  encodeCursor,
  EventWhere,
  LIMITS,
  rruleOccurrences,
  TimeIdCursor,
  type UpdateCrewBody,
  type ModerationPreview,
  type PublicCrewView,
} from '@touchgrass/shared';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  crewMembers,
  crewRecurrence,
  crews,
  crewSessions,
} from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { withRedisLock } from '../../infra/redis/redis-lock.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { EventInvitesService } from '../events/event-invites.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { EventsService } from '../events/events.service.js';
import { MediaService } from '../media/media.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { SocialGraphService, uuidArrayLiteral } from '../social/graph/social-graph.service.js';
import { UsersService } from '../users/users.service.js';
import { VenuesService } from '../venues/venues.service.js';
import {
  canManage,
  canSeeCrew,
  type CrewReason,
  isActive,
  type Membership,
  memberAction,
  membershipChange,
  missingOccurrences,
} from './crews.policy.js';

export const CREW_INVITED_EVENT = 'crew.invited';
export const CREW_REQUESTED_EVENT = 'crew.requested';
export const CREW_APPROVED_EVENT = 'crew.approved';

type CrewRow = typeof crews.$inferSelect;
type MemberRow = typeof crewMembers.$inferSelect;
const DAY_MS = 86_400_000;
const C = LIMITS.crews;
const UPCOMING_LIMIT = 6;

function denied(reason: CrewReason): AppError {
  if (reason === 'NOT_FOUND') return AppError.notFound('Crew member');
  return new AppError('NOT_ELIGIBLE', 'Not allowed for this crew', { reason });
}

/**
 * Recurring crews (F-ENG-02): members with admin/member roles, join by invite or request, a recurrence rule
 * that generates `crew_session` events ahead of time, crew chat, and attendance history.
 */
@Injectable()
export class CrewsService {
  private readonly logger = new Logger(CrewsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly outbox: OutboxService,
    private readonly users: UsersService,
    private readonly people: PeopleService,
    private readonly graph: SocialGraphService,
    private readonly media: MediaService,
    private readonly venues: VenuesService,
    private readonly events: EventsService,
    private readonly invites: EventInvitesService,
    private readonly search: EventSearchService,
    private readonly store: EventStore,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
    private readonly profiles: ProfilesService,
  ) {}

  // ---------- reading ----------

  private async crewOrThrow(crewId: string, db: Database | Tx = this.db): Promise<CrewRow> {
    const [row] = await db.select().from(crews).where(eq(crews.id, crewId));
    if (!row) throw AppError.notFound('Crew');
    return row;
  }

  async membership(
    crewId: string,
    userId: string,
    db: Database | Tx = this.db,
  ): Promise<Membership | null> {
    const [m] = await db
      .select({ role: crewMembers.role, status: crewMembers.status })
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId)));
    return m ?? null;
  }

  /** The crew, if the viewer may see it; blocked creators keep their crews out of sight. */
  private async visible(
    viewerId: string,
    crewId: string,
  ): Promise<{ crew: CrewRow; m: Membership | null }> {
    const [crew, m] = await Promise.all([
      this.db.select().from(crews).where(eq(crews.id, crewId)),
      this.membership(crewId, viewerId),
    ]);
    const row = crew[0];
    if (!row || !canSeeCrew(row, m)) throw AppError.notFound('Crew');
    if (!m && row.createdBy && (await this.graph.isBlockedEitherWay(viewerId, row.createdBy)))
      throw AppError.notFound('Crew');
    return { crew: row, m };
  }

  private async counts(crewIds: string[]): Promise<Map<string, number>> {
    if (crewIds.length === 0) return new Map();
    const rows = await this.db
      .select({ crewId: crewMembers.crewId, n: count() })
      .from(crewMembers)
      .where(and(inArray(crewMembers.crewId, crewIds), eq(crewMembers.status, 'active')))
      .groupBy(crewMembers.crewId);
    return new Map(rows.map((r) => [r.crewId, r.n]));
  }

  private async adminCount(crewId: string, db: Database | Tx = this.db): Promise<number> {
    return db.$count(
      crewMembers,
      and(
        eq(crewMembers.crewId, crewId),
        eq(crewMembers.status, 'active'),
        eq(crewMembers.role, 'admin'),
      ),
    );
  }

  async activeMemberIds(crewId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: crewMembers.userId })
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.status, 'active')));
    return rows.map((r) => r.userId);
  }

  async adminIds(crewId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: crewMembers.userId })
      .from(crewMembers)
      .where(
        and(
          eq(crewMembers.crewId, crewId),
          eq(crewMembers.status, 'active'),
          eq(crewMembers.role, 'admin'),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /** Crews someone is an active member of (group challenges). */
  async activeCrewsOf(userId: string): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: crews.id, name: crews.name })
      .from(crewMembers)
      .innerJoin(crews, eq(crews.id, crewMembers.crewId))
      .where(
        and(
          eq(crewMembers.userId, userId),
          eq(crewMembers.status, 'active'),
          eq(crews.status, 'active'),
        ),
      );
  }

  async names(crewIds: string[]): Promise<Map<string, string>> {
    if (crewIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: crews.id, name: crews.name })
      .from(crews)
      .where(inArray(crews.id, crewIds));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** The crew a crew session belongs to (event detail, gamification). */
  async crewOfEvent(eventId: string): Promise<{ id: string; name: string } | null> {
    const [row] = await this.db
      .select({ id: crews.id, name: crews.name })
      .from(crewSessions)
      .innerJoin(crews, eq(crews.id, crewSessions.crewId))
      .where(eq(crewSessions.eventId, eventId));
    return row ?? null;
  }

  private async sessions(
    viewerId: string,
    crewId: string,
    opts: { upcoming: boolean; now: Date; limit: number; after?: TimeIdCursor | null },
  ): Promise<(CrewSession & { attended: boolean })[]> {
    const order = opts.upcoming ? asc(crewSessions.occurrenceAt) : desc(crewSessions.occurrenceAt);
    const cursor = opts.after
      ? sql`(${crewSessions.occurrenceAt}, ${crewSessions.eventId}) < (${new Date(opts.after.t)}, ${opts.after.id})`
      : sql`true`;
    const rows = await this.db
      .select()
      .from(crewSessions)
      .where(
        and(
          eq(crewSessions.crewId, crewId),
          opts.upcoming
            ? gte(crewSessions.occurrenceAt, opts.now)
            : lt(crewSessions.occurrenceAt, opts.now),
          cursor,
        ),
      )
      .orderBy(order, desc(crewSessions.eventId))
      .limit(opts.limit);
    const ids = rows.map((r) => r.eventId);
    const [cores, seats, checked, mine] = await Promise.all([
      this.store.coresByIds(ids),
      this.store.seatCountsMany(ids),
      this.search.checkedInCounts(ids),
      this.search.rsvpStatuses(viewerId, ids),
    ]);
    const byId = new Map(cores.map((c) => [c.id, c]));
    return rows.flatMap((r) => {
      const core = byId.get(r.eventId);
      if (!core || core.status === 'draft') return [];
      const viewerRsvp = mine.get(r.eventId) ?? null;
      return [
        {
          eventId: r.eventId,
          startsAt: core.startsAt.toISOString(),
          endsAt: core.endsAt.toISOString(),
          status: core.status,
          goingCount: seats.get(r.eventId)?.seats ?? 0,
          checkedInCount: checked.get(r.eventId) ?? 0,
          viewerRsvp,
          attended: viewerRsvp === 'checked_in',
        },
      ];
    });
  }

  private async summaries(viewerId: string, rows: CrewRow[], now: Date): Promise<CrewSummary[]> {
    const ids = rows.map((r) => r.id);
    const [counts, memberships, next, covers] = await Promise.all([
      this.counts(ids),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(crewMembers)
            .where(and(inArray(crewMembers.crewId, ids), eq(crewMembers.userId, viewerId))),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            .selectDistinctOn([crewSessions.crewId])
            .from(crewSessions)
            .where(and(inArray(crewSessions.crewId, ids), gte(crewSessions.occurrenceAt, now)))
            .orderBy(crewSessions.crewId, asc(crewSessions.occurrenceAt)),
      this.coverUrls(rows),
    ]);
    const mine = new Map(memberships.map((m) => [m.crewId, m]));
    const nextBy = new Map(next.map((n) => [n.crewId, n]));
    return rows.map((r) => {
      const m = mine.get(r.id);
      const n = nextBy.get(r.id);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        cover: covers.get(r.id) ?? null,
        interestId: r.interestId,
        joinPolicy: r.joinPolicy,
        memberCount: counts.get(r.id) ?? 0,
        nextSession: n ? { eventId: n.eventId, startsAt: n.occurrenceAt.toISOString() } : null,
        viewer: { role: m?.status === 'active' ? m.role : null, status: m?.status ?? null },
        held: r.heldAt !== null,
      };
    });
  }

  private async coverUrls(rows: CrewRow[]): Promise<Map<string, CrewSummary['cover']>> {
    const withCover = rows.filter((r) => r.coverMediaId !== null);
    if (withCover.length === 0) return new Map();
    const assets = await this.media.byIds(
      withCover.flatMap((r) => (r.coverMediaId ? [r.coverMediaId] : [])),
    );
    const byAsset = new Map(assets.map((a) => [a.id, a]));
    const out = new Map<string, CrewSummary['cover']>();
    for (const r of withCover) {
      const a = r.coverMediaId ? byAsset.get(r.coverMediaId) : undefined;
      if (a?.status === 'ready') out.set(r.id, await this.media.urlsFor(a.variantKeys));
    }
    return out;
  }

  async list(viewerId: string, q: CrewListQuery, now: Date = new Date()): Promise<CrewList> {
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const cursor = after
      ? sql`(${crews.createdAt}, ${crews.id}) < (${new Date(after.t)}, ${after.id})`
      : sql`true`;
    let rows: CrewRow[];
    if (q.scope === 'mine') {
      rows = await this.db
        .select({ crew: crews })
        .from(crewMembers)
        .innerJoin(crews, eq(crews.id, crewMembers.crewId))
        .where(and(eq(crewMembers.userId, viewerId), eq(crews.status, 'active'), cursor))
        .orderBy(desc(crews.createdAt), desc(crews.id))
        .limit(q.limit + 1)
        .then((r) => r.map((x) => x.crew));
    } else {
      const user = await this.users.findById(viewerId);
      const blocked = [...(await this.graph.blockedSet(viewerId))];
      rows = await this.db
        .select()
        .from(crews)
        .where(
          and(
            eq(crews.status, 'active'),
            eq(crews.joinPolicy, 'request'),
            isNull(crews.heldAt),
            user?.cityId ? eq(crews.cityId, user.cityId) : sql`true`,
            sql`NOT EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = ${crews.id} AND m.user_id = ${viewerId})`,
            blocked.length > 0
              ? or(
                  sql`${crews.createdBy} IS NULL`,
                  sql`NOT (${crews.createdBy} = ANY(${uuidArrayLiteral(blocked)}::uuid[]))`,
                )
              : sql`true`,
            cursor,
          ),
        )
        .orderBy(desc(crews.createdAt), desc(crews.id))
        .limit(q.limit + 1);
    }
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await this.summaries(viewerId, page, now),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Search (F-DSC-09): crews you're in, plus open (request-policy, not held) crews whose creator you haven't
   * blocked. Invite-only crews never show to outsiders. Name matches rank by trigram similarity.
   */
  async searchByName(
    viewerId: string,
    text: string,
    limit: number,
    now: Date = new Date(),
  ): Promise<CrewSummary[]> {
    const blocked = [...(await this.graph.blockedSet(viewerId))];
    const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db
      .select()
      .from(crews)
      .where(
        and(
          eq(crews.status, 'active'),
          or(sql`${crews.name} ILIKE ${pattern}`, sql`${crews.name} % ${text}`),
          or(
            sql`EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = ${crews.id} AND m.user_id = ${viewerId} AND m.status = 'active')`,
            and(
              eq(crews.joinPolicy, 'request'),
              isNull(crews.heldAt),
              blocked.length > 0
                ? or(
                    sql`${crews.createdBy} IS NULL`,
                    sql`NOT (${crews.createdBy} = ANY(${uuidArrayLiteral(blocked)}::uuid[]))`,
                  )
                : sql`true`,
            ),
          ),
        ),
      )
      .orderBy(sql`similarity(${crews.name}, ${text}) DESC`, desc(crews.createdAt))
      .limit(limit);
    return this.summaries(viewerId, rows, now);
  }

  async detail(viewerId: string, crewId: string, now: Date = new Date()): Promise<CrewDetail> {
    const { crew, m } = await this.visible(viewerId, crewId);
    const manage = canManage(m);
    const [summary] = await this.summaries(viewerId, [crew], now);
    if (!summary) throw AppError.notFound('Crew');
    const memberRows = await this.db
      .select()
      .from(crewMembers)
      .where(
        and(
          eq(crewMembers.crewId, crewId),
          manage ? ne(crewMembers.status, 'invited') : eq(crewMembers.status, 'active'),
        ),
      )
      .orderBy(asc(crewMembers.createdAt))
      .limit(C.maxMembers * 2);
    const past = isActive(m)
      ? await this.db
          .select({ eventId: crewSessions.eventId })
          .from(crewSessions)
          .where(and(eq(crewSessions.crewId, crewId), lt(crewSessions.occurrenceAt, now)))
      : [];
    const [cards, attended, upcoming, recurrence] = await Promise.all([
      this.people.cards(
        viewerId,
        memberRows.map((r) => r.userId),
        { includeSelf: true },
      ),
      this.search.attendanceCounts(past.map((p) => p.eventId)),
      isActive(m)
        ? this.sessions(viewerId, crewId, { upcoming: true, now, limit: UPCOMING_LIMIT })
        : Promise.resolve([]),
      this.recurrenceView(crewId),
    ]);
    const toMember = (r: MemberRow): CrewMember[] => {
      const person = cards.get(r.userId);
      return person
        ? [
            {
              person,
              role: r.role,
              status: r.status,
              attended: attended.get(r.userId) ?? 0,
              since: (r.joinedAt ?? r.createdAt).toISOString(),
            },
          ]
        : [];
    };
    return {
      ...summary,
      members: memberRows.filter((r) => r.status === 'active').flatMap(toMember),
      requests: manage ? memberRows.filter((r) => r.status === 'requested').flatMap(toMember) : [],
      recurrence,
      upcoming: upcoming.map(({ attended: _a, ...s }) => s),
      canManage: manage,
    };
  }

  private async recurrenceView(crewId: string): Promise<CrewRecurrence | null> {
    const [r] = await this.db
      .select()
      .from(crewRecurrence)
      .where(eq(crewRecurrence.crewId, crewId));
    return r
      ? {
          rrule: r.rrule,
          startsAt: r.startsAt.toISOString(),
          durationMinutes: r.durationMinutes,
          capacity: r.capacity,
          title: r.title,
          placeLabel: r.placeLabel,
          active: r.active,
        }
      : null;
  }

  async history(
    viewerId: string,
    crewId: string,
    cursor: string | undefined,
    limit: number,
    now: Date = new Date(),
  ): Promise<CrewHistory> {
    const { m } = await this.visible(viewerId, crewId);
    if (!isActive(m)) throw denied('NOT_CREW_MEMBER');
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const items = await this.sessions(viewerId, crewId, {
      upcoming: false,
      now,
      limit: limit + 1,
      after,
    });
    const page = items.slice(0, limit);
    const last = page.at(-1);
    const allPast = await this.db
      .select({ eventId: crewSessions.eventId })
      .from(crewSessions)
      .where(and(eq(crewSessions.crewId, crewId), lt(crewSessions.occurrenceAt, now)));
    const statuses = await this.search.rsvpStatuses(
      viewerId,
      allPast.map((p) => p.eventId),
    );
    return {
      items: page,
      attendedCount: [...statuses.values()].filter((s) => s === 'checked_in').length,
      nextCursor:
        items.length > limit && last ? encodeCursor({ t: last.startsAt, id: last.eventId }) : null,
    };
  }

  // ---------- writing ----------

  private async assertCover(userId: string, mediaId: string): Promise<void> {
    const asset = await this.media.ownedOrThrow(userId, mediaId);
    if (asset.purpose !== 'event_cover')
      throw new AppError('VALIDATION_FAILED', 'Not a cover image', [
        { path: 'coverMediaId', message: 'Wrong purpose', code: 'custom' },
      ]);
    if (asset.status !== 'ready')
      throw new AppError('MEDIA_NOT_READY', 'Cover is still processing');
  }

  async create(userId: string, body: CreateCrewBody, now: Date = new Date()): Promise<CrewDetail> {
    if (body.coverMediaId) await this.assertCover(userId, body.coverMediaId);
    await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body.name, body.description);
    const user = await this.users.findById(userId);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(crews).values({
        heldAt: screen.flagged ? now : null,
        id,
        cityId: user?.cityId ?? null,
        name: body.name,
        description: body.description,
        interestId: body.interestId,
        coverMediaId: body.coverMediaId,
        joinPolicy: body.joinPolicy,
        createdBy: userId,
      });
      await tx
        .insert(crewMembers)
        .values({ crewId: id, userId, role: 'admin', status: 'active', joinedAt: now });
      await this.moderation.flagText(
        { type: 'crew', id, cityId: user?.cityId ?? null },
        screen,
        tx,
      );
    });
    return this.detail(userId, id, now);
  }

  private async requireAdmin(userId: string, crewId: string): Promise<CrewRow> {
    const crew = await this.crewOrThrow(crewId);
    const m = await this.membership(crewId, userId);
    if (!canSeeCrew(crew, m)) throw AppError.notFound('Crew');
    if (!canManage(m)) throw denied('CREW_ADMIN_ONLY');
    return crew;
  }

  async update(userId: string, crewId: string, body: UpdateCrewBody): Promise<CrewDetail> {
    const crew = await this.requireAdmin(userId, crewId);
    if (body.coverMediaId) await this.assertCover(userId, body.coverMediaId);
    const screen = this.moderation.screen(body.name, body.description);
    await this.db.transaction(async (tx) => {
      await tx
        .update(crews)
        .set({ ...body, ...(screen.flagged ? { heldAt: new Date() } : {}) })
        .where(eq(crews.id, crewId));
      await this.moderation.flagText({ type: 'crew', id: crewId, cityId: crew.cityId }, screen, tx);
    });
    return this.detail(userId, crewId);
  }

  async membershipAction(
    userId: string,
    crewId: string,
    body: CrewMembershipBody,
    now: Date = new Date(),
  ): Promise<CrewDetail | null> {
    const notify = await this.db.transaction(async (tx) => {
      const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('update');
      if (!crew) throw AppError.notFound('Crew');
      const m = await this.membership(crewId, userId, tx);
      if (!canSeeCrew(crew, m)) throw AppError.notFound('Crew');
      if (
        !m &&
        body.action === 'join' &&
        crew.createdBy &&
        (await this.graph.isBlockedEitherWay(userId, crew.createdBy))
      )
        throw AppError.notFound('Crew');
      const activeCount = await tx.$count(
        crewMembers,
        and(eq(crewMembers.crewId, crewId), eq(crewMembers.status, 'active')),
      );
      const change = membershipChange(crew.joinPolicy, m, body.action, {
        admins: await this.adminCount(crewId, tx),
        activeCount,
        maxMembers: C.maxMembers,
      });
      const where = and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId));
      switch (change.kind) {
        case 'error':
          throw denied(change.reason);
        case 'none':
          return null;
        case 'insert':
          await tx
            .insert(crewMembers)
            .values({ crewId, userId, role: 'member', status: 'requested' });
          await this.outbox.add(tx, {
            aggregateType: 'crew',
            aggregateId: crewId,
            type: CREW_REQUESTED_EVENT,
            payload: { crewId, userId },
          });
          return null;
        case 'activate':
          await tx.update(crewMembers).set({ status: 'active', joinedAt: now }).where(where);
          return 'joined' as const;
        case 'delete':
          await tx.delete(crewMembers).where(where);
          if (body.action === 'leave' && activeCount <= 1)
            await tx.update(crews).set({ status: 'archived' }).where(eq(crews.id, crewId));
          return null;
      }
    });
    if (notify === 'joined') await this.inviteToUpcoming(crewId, [userId], now);
    if (body.action === 'leave' || body.action === 'decline') return null;
    return this.detail(userId, crewId, now);
  }

  async memberActionFor(
    adminId: string,
    crewId: string,
    targetId: string,
    body: CrewMemberActionBody,
    now: Date = new Date(),
  ): Promise<CrewDetail> {
    const activated = await this.db.transaction(async (tx) => {
      const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('update');
      if (!crew) throw AppError.notFound('Crew');
      const actor = await this.membership(crewId, adminId, tx);
      if (!canSeeCrew(crew, actor)) throw AppError.notFound('Crew');
      const target = await this.membership(crewId, targetId, tx);
      const result = memberAction(actor, adminId === targetId, target, body.action, {
        admins: await this.adminCount(crewId, tx),
        activeCount: await tx.$count(
          crewMembers,
          and(eq(crewMembers.crewId, crewId), eq(crewMembers.status, 'active')),
        ),
        maxMembers: C.maxMembers,
      });
      const where = and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, targetId));
      switch (result.kind) {
        case 'error':
          throw denied(result.reason);
        case 'activate':
          await tx.update(crewMembers).set({ status: 'active', joinedAt: now }).where(where);
          await this.outbox.add(tx, {
            aggregateType: 'crew',
            aggregateId: crewId,
            type: CREW_APPROVED_EVENT,
            payload: { crewId, userId: targetId },
          });
          return true;
        case 'delete':
          await tx.delete(crewMembers).where(where);
          return false;
        case 'role':
          await tx.update(crewMembers).set({ role: result.role }).where(where);
          return false;
      }
    });
    if (activated) await this.inviteToUpcoming(crewId, [targetId], now);
    return this.detail(adminId, crewId, now);
  }

  /** Admins invite people from their squad; they join by accepting. */
  async invite(adminId: string, crewId: string, userIds: string[]): Promise<{ invited: number }> {
    await this.requireAdmin(adminId, crewId);
    const squad = new Set(await this.graph.friendIds(adminId));
    const blocked = await this.graph.blockedSet(adminId);
    const candidates = [...new Set(userIds)].filter((id) => squad.has(id) && !blocked.has(id));
    if (candidates.length === 0) return { invited: 0 };
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(crewMembers)
        .values(
          candidates.map((userId) => ({
            crewId,
            userId,
            role: 'member' as const,
            status: 'invited' as const,
            invitedBy: adminId,
          })),
        )
        .onConflictDoNothing()
        .returning({ userId: crewMembers.userId });
      if (rows.length > 0)
        await this.outbox.add(tx, {
          aggregateType: 'crew',
          aggregateId: crewId,
          type: CREW_INVITED_EVENT,
          payload: { crewId, inviterId: adminId, userIds: rows.map((r) => r.userId) },
        });
      return { invited: rows.length };
    });
  }

  // ---------- recurrence (sessions) ----------

  private async placeLabel(where: EventWhere): Promise<string> {
    if ('venueId' in where) {
      const venue = await this.venues.byId(where.venueId);
      if (!venue) throw AppError.notFound('Venue');
      return venue.name;
    }
    return where.placeName ?? where.address;
  }

  /**
   * Sets the schedule. Upcoming sessions nobody but the host has pulled up to are cancelled and regenerated
   * from the new rule; sessions people already committed to stay.
   */
  async setRecurrence(
    adminId: string,
    crewId: string,
    body: CrewRecurrenceBody,
    now: Date = new Date(),
  ): Promise<CrewDetail> {
    const crew = await this.requireAdmin(adminId, crewId);
    if (!crew.interestId)
      throw new AppError('NOT_ELIGIBLE', 'Pick what the crew does first', {
        reason: 'BAD_RECURRENCE',
      });
    const placeLabel = await this.placeLabel(body.where);
    const values = {
      rrule: body.rrule,
      startsAt: new Date(body.startsAt),
      durationMinutes: body.durationMinutes,
      capacity: body.capacity,
      title: body.title,
      locationWhere: body.where,
      placeLabel,
      hostUserId: adminId,
      active: body.active,
      generatedUntil: null,
    };
    await this.db
      .insert(crewRecurrence)
      .values({ crewId, ...values })
      .onConflictDoUpdate({ target: crewRecurrence.crewId, set: values });
    await this.cancelUncommitted(crewId, adminId, now);
    if (body.active) await this.generate(crewId, now);
    return this.detail(adminId, crewId, now);
  }

  private async cancelUncommitted(crewId: string, adminId: string, now: Date): Promise<void> {
    const upcoming = await this.db
      .select()
      .from(crewSessions)
      .where(and(eq(crewSessions.crewId, crewId), gte(crewSessions.occurrenceAt, now)));
    if (upcoming.length === 0) return;
    const seats = await this.store.seatCountsMany(upcoming.map((u) => u.eventId));
    for (const s of upcoming) {
      if ((seats.get(s.eventId)?.seats ?? 0) > 1) continue;
      const core = await this.store.core(s.eventId);
      if (!core || core.status !== 'published') continue;
      const hosts = await this.store.hosts(s.eventId);
      const host = hosts.find((h) => h.role === 'host')?.userId ?? adminId;
      try {
        await this.events.cancel(host, s.eventId, 'Schedule changed', now);
      } catch (err) {
        this.logger.warn(`Could not cancel crew session ${s.eventId}: ${String(err)}`);
        continue;
      }
      await this.db
        .delete(crewSessions)
        .where(and(eq(crewSessions.crewId, crewId), eq(crewSessions.eventId, s.eventId)));
    }
  }

  /**
   * Creates the sessions due in the next `sessionLeadDays` days and invites the members. Serialised per crew
   * so two workers never create the same session twice.
   */
  async generate(crewId: string, now: Date = new Date()): Promise<number> {
    return withRedisLock(
      this.redis,
      `crew-sessions:${crewId}`,
      async () => {
        const [rec] = await this.db
          .select()
          .from(crewRecurrence)
          .where(eq(crewRecurrence.crewId, crewId));
        const crew = await this.crewOrThrow(crewId);
        if (!rec?.active || !rec.hostUserId || crew.status !== 'active' || !crew.interestId)
          return 0;
        const host = await this.membership(crewId, rec.hostUserId);
        if (!canManage(host)) return 0;
        const until = new Date(now.getTime() + C.sessionLeadDays * DAY_MS);
        const occurrences = rruleOccurrences(rec.rrule, rec.startsAt, now, until, 31);
        const existing = await this.db
          .select({ at: crewSessions.occurrenceAt })
          .from(crewSessions)
          .where(and(eq(crewSessions.crewId, crewId), gte(crewSessions.occurrenceAt, now)));
        const todo = missingOccurrences(occurrences, new Set(existing.map((e) => e.at.getTime())));
        const where = EventWhere.parse(rec.locationWhere);
        const members = await this.activeMemberIds(crewId);
        let created = 0;
        for (const at of todo) {
          const body = CreateEventBody.parse({
            title: rec.title || crew.name,
            description: crew.description,
            categoryInterestId: crew.interestId,
            where,
            startsAt: at.toISOString(),
            endsAt: new Date(at.getTime() + rec.durationMinutes * 60_000).toISOString(),
            capacity: rec.capacity,
            visibility: 'invite_only',
            coverMediaId: null,
            publish: true,
          });
          let eventId: string;
          try {
            eventId = (
              await this.events.create(rec.hostUserId, [], body, now, { type: 'crew_session' })
            ).id;
          } catch (err) {
            this.logger.warn(
              `Crew ${crewId} session at ${at.toISOString()} not created: ${String(err)}`,
            );
            break;
          }
          await this.db.insert(crewSessions).values({ crewId, occurrenceAt: at, eventId });
          await this.invites.grantInvites(eventId, rec.hostUserId, members);
          created += 1;
        }
        await this.db
          .update(crewRecurrence)
          .set({ generatedUntil: until })
          .where(eq(crewRecurrence.crewId, crewId));
        return created;
      },
      { ttlMs: 60_000, waitMs: 60_000 },
    );
  }

  /** Hourly worker job: top up sessions for every active schedule. */
  async generateDue(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({ crewId: crewRecurrence.crewId })
      .from(crewRecurrence)
      .where(
        and(
          eq(crewRecurrence.active, true),
          or(
            sql`${crewRecurrence.generatedUntil} IS NULL`,
            lt(
              crewRecurrence.generatedUntil,
              new Date(now.getTime() + (C.sessionLeadDays - 1) * DAY_MS),
            ),
          ),
        ),
      );
    let created = 0;
    for (const d of due) {
      try {
        created += await this.generate(d.crewId, now);
      } catch (err) {
        this.logger.warn(`Crew ${d.crewId} generation failed: ${String(err)}`);
      }
    }
    return created;
  }

  /** New members get invited to the sessions already on the calendar. */
  private async inviteToUpcoming(crewId: string, userIds: string[], now: Date): Promise<void> {
    const upcoming = await this.db
      .select({ eventId: crewSessions.eventId })
      .from(crewSessions)
      .where(and(eq(crewSessions.crewId, crewId), gte(crewSessions.occurrenceAt, now)));
    const [rec] = await this.db
      .select()
      .from(crewRecurrence)
      .where(eq(crewRecurrence.crewId, crewId));
    for (const s of upcoming) {
      const hosts = await this.store.hosts(s.eventId);
      const host = hosts.find((h) => h.role === 'host')?.userId ?? rec?.hostUserId;
      if (host) await this.invites.grantInvites(s.eventId, host, userIds);
    }
  }

  // ---------- chat gate ----------

  async chatAccess(userId: string, crewId: string): Promise<{ read: boolean; host: boolean }> {
    const [crew] = await this.db.select().from(crews).where(eq(crews.id, crewId));
    const m = await this.membership(crewId, userId);
    const ok = crew?.status === 'active' && isActive(m);
    return { read: ok, host: ok && canManage(m) };
  }

  async chatInfo(
    crewIds: string[],
  ): Promise<Map<string, { title: string; avatar: CrewSummary['cover'] }>> {
    if (crewIds.length === 0) return new Map();
    const rows = await this.db.select().from(crews).where(inArray(crews.id, crewIds));
    const covers = await this.coverUrls(rows);
    return new Map(rows.map((r) => [r.id, { title: r.name, avatar: covers.get(r.id) ?? null }]));
  }

  // ---------- account data ----------

  /** What a shared crew link shows anyone (F-GRW-02): open crews only, never held ones. */
  async shareView(crewId: string): Promise<PublicCrewView | null> {
    const [crew] = await this.db.select().from(crews).where(eq(crews.id, crewId));
    if (!crew || crew.status !== 'active' || crew.joinPolicy !== 'request' || crew.heldAt)
      return null;
    const [counts, covers] = await Promise.all([this.counts([crew.id]), this.coverUrls([crew])]);
    return {
      id: crew.id,
      name: crew.name,
      description: crew.description,
      memberCount: counts.get(crew.id) ?? 0,
      cover: covers.get(crew.id) ?? null,
    };
  }

  // ---------- moderation (F-SAF-06) ----------

  async moderationPreview(crewId: string): Promise<ModerationPreview> {
    const [crew] = await this.db.select().from(crews).where(eq(crews.id, crewId));
    if (!crew || crew.status !== 'active') return GONE;
    const [covers, names] = await Promise.all([
      this.coverUrls([crew]),
      this.profiles.displayNames(crew.createdBy ? [crew.createdBy] : []),
    ]);
    return {
      title: crew.name,
      text: crew.description || null,
      image: covers.get(crew.id) ?? null,
      owner: crew.createdBy
        ? { id: crew.createdBy, displayName: names.get(crew.createdBy) ?? '' }
        : null,
      gone: false,
    };
  }

  async releaseHeld(crewId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(crews).set({ heldAt: null }).where(eq(crews.id, crewId));
    return undefined;
  }

  /** Takes a crew down: archived, so it disappears from discovery and stops generating sessions. */
  async removeForModeration(crewId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(crews).set({ status: 'archived', heldAt: null }).where(eq(crews.id, crewId));
    await tx.update(crewRecurrence).set({ active: false }).where(eq(crewRecurrence.crewId, crewId));
    return undefined;
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({
        crew: crews.name,
        crewId: crewMembers.crewId,
        role: crewMembers.role,
        status: crewMembers.status,
        joinedAt: crewMembers.joinedAt,
      })
      .from(crewMembers)
      .innerJoin(crews, eq(crews.id, crewMembers.crewId))
      .where(eq(crewMembers.userId, userId));
    return {
      crews: rows.map((r) => ({ ...r, joinedAt: r.joinedAt?.toISOString() ?? null })),
    };
  }

  /**
   * Leaving TouchGrass leaves every crew. A crew whose last admin leaves passes to its longest-standing
   * member; an empty crew is archived.
   */
  async eraseFor(userId: string, tx: Tx, now: Date = new Date()): Promise<void> {
    const mine = await tx.select().from(crewMembers).where(eq(crewMembers.userId, userId));
    await tx.delete(crewMembers).where(eq(crewMembers.userId, userId));
    for (const m of mine) {
      if (m.status !== 'active') continue;
      const rest = await tx
        .select()
        .from(crewMembers)
        .where(and(eq(crewMembers.crewId, m.crewId), eq(crewMembers.status, 'active')))
        .orderBy(asc(crewMembers.joinedAt));
      if (rest.length === 0) {
        await tx.update(crews).set({ status: 'archived' }).where(eq(crews.id, m.crewId));
        continue;
      }
      const first = rest[0];
      if (m.role === 'admin' && first && !rest.some((r) => r.role === 'admin'))
        await tx
          .update(crewMembers)
          .set({ role: 'admin' })
          .where(and(eq(crewMembers.crewId, m.crewId), eq(crewMembers.userId, first.userId)));
      await tx
        .update(crewRecurrence)
        .set({ hostUserId: first?.userId ?? null, generatedUntil: now })
        .where(and(eq(crewRecurrence.crewId, m.crewId), eq(crewRecurrence.hostUserId, userId)));
    }
    await tx.update(crews).set({ createdBy: null }).where(eq(crews.createdBy, userId));
  }
}
