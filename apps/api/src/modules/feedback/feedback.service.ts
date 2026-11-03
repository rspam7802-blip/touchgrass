import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminFeedbackQuery,
  type AdminFeedbackRow,
  averageRating,
  decodeCursor,
  encodeCursor,
  type FeedbackBody,
  type FeedbackSummary,
  LIMITS,
  type MyFeedback,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { eventFeedback, hostRatings } from '../../infra/database/schema/index.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventStore } from '../events/event-store.service.js';
import type { EventFeedbackSummary } from '../hosting/feedback-reader.js';
import { PeopleService } from '../profiles/people.service.js';
import { feedbackBlock, tally } from './feedback.policy.js';

const AdminCursor = z.object({ v: z.number(), id: z.uuid() });
type FeedbackRow = typeof eventFeedback.$inferSelect;

/**
 * Post-event feedback and host ratings (F-AFT-02, F-AFT-05). Ratings and tags are aggregated for hosts and
 * admins; comments go to the hosts without names, and only once enough people answered that nobody can be
 * singled out.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: EventAccessService,
    private readonly store: EventStore,
    private readonly people: PeopleService,
  ) {}

  private async eligible(userId: string, eventId: string, now: Date) {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    const block = feedbackBlock(
      { checkedIn: facts.rsvp === 'checked_in', isHost: facts.hostRole !== null },
      core,
      now,
    );
    if (block)
      throw new AppError('NOT_ELIGIBLE', 'You cannot give feedback on this plan', {
        reason: block,
      });
    return { core, facts };
  }

  async submit(
    userId: string,
    eventId: string,
    body: FeedbackBody,
    now: Date = new Date(),
  ): Promise<MyFeedback> {
    const { core, facts } = await this.eligible(userId, eventId, now);
    const primary = facts.hosts.find((h) => h.role === 'host')?.userId ?? core.creatorUserId;
    const great = [...new Set(body.great)];
    const improve = [...new Set(body.improve)];
    await this.db.transaction(async (tx) => {
      await tx
        .insert(eventFeedback)
        .values({ eventId, userId, rating: body.rating, great, improve, comment: body.comment })
        .onConflictDoUpdate({
          target: [eventFeedback.eventId, eventFeedback.userId],
          set: { rating: body.rating, great, improve, comment: body.comment },
        });
      if (body.hostRating === null || primary === userId)
        await tx
          .delete(hostRatings)
          .where(and(eq(hostRatings.eventId, eventId), eq(hostRatings.raterId, userId)));
      else
        await tx
          .insert(hostRatings)
          .values({ eventId, raterId: userId, hostUserId: primary, rating: body.hostRating })
          .onConflictDoUpdate({
            target: [hostRatings.eventId, hostRatings.raterId],
            set: { rating: body.hostRating, hostUserId: primary },
          });
    });
    const mine = await this.mine(userId, eventId);
    if (!mine) throw new AppError('INTERNAL', 'Feedback vanished');
    return mine;
  }

  async mine(userId: string, eventId: string): Promise<MyFeedback | null> {
    const [f] = await this.db
      .select()
      .from(eventFeedback)
      .where(and(eq(eventFeedback.eventId, eventId), eq(eventFeedback.userId, userId)));
    if (!f) return null;
    const [h] = await this.db
      .select({ rating: hostRatings.rating })
      .from(hostRatings)
      .where(and(eq(hostRatings.eventId, eventId), eq(hostRatings.raterId, userId)));
    return {
      rating: f.rating,
      hostRating: h?.rating ?? null,
      great: f.great as MyFeedback['great'],
      improve: f.improve as MyFeedback['improve'],
      comment: f.comment,
      createdAt: f.createdAt.toISOString(),
    };
  }

  /** Hosts and co-hosts see the aggregate (comments only once enough people answered). */
  async summary(hostId: string, eventId: string): Promise<FeedbackSummary> {
    await this.access.requireHost(hostId, eventId, { roles: ['host', 'co_host'] });
    const rows = await this.db
      .select()
      .from(eventFeedback)
      .where(eq(eventFeedback.eventId, eventId))
      .orderBy(desc(eventFeedback.createdAt));
    const hr = await this.db
      .select({ rating: hostRatings.rating })
      .from(hostRatings)
      .where(eq(hostRatings.eventId, eventId));
    return this.aggregate(
      eventId,
      rows,
      hr.map((h) => h.rating),
      true,
    );
  }

  private aggregate(
    eventId: string,
    rows: FeedbackRow[],
    hostScores: number[],
    withComments: boolean,
  ): FeedbackSummary {
    const anonymous = rows.length >= LIMITS.after.minRatingsToShow;
    return {
      eventId,
      count: rows.length,
      averageRating: averageRating(
        rows.reduce((s, r) => s + r.rating, 0),
        rows.length,
      ),
      hostAverage: averageRating(
        hostScores.reduce((s, r) => s + r, 0),
        hostScores.length,
      ),
      hostCount: hostScores.length,
      great: tally(rows.map((r) => r.great)),
      improve: tally(rows.map((r) => r.improve)),
      comments:
        withComments && anonymous
          ? rows
              .filter((r) => r.comment.trim() !== '')
              .map((r) => ({
                comment: r.comment,
                rating: r.rating,
                createdAt: r.createdAt.toISOString(),
              }))
          : [],
    };
  }

  /** Host analytics source (F-HST-02): average rating, count and top themes per plan. */
  async summaries(eventIds: string[]): Promise<Map<string, EventFeedbackSummary>> {
    const out = new Map<string, EventFeedbackSummary>(
      eventIds.map((id) => [id, { averageRating: null, ratingsCount: 0, themes: [] }]),
    );
    if (eventIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(eventFeedback)
      .where(inArray(eventFeedback.eventId, eventIds));
    for (const id of eventIds) {
      const mine = rows.filter((r) => r.eventId === id);
      if (mine.length === 0) continue;
      out.set(id, {
        averageRating: averageRating(
          mine.reduce((s, r) => s + r.rating, 0),
          mine.length,
        ),
        ratingsCount: mine.length,
        themes: tally(
          mine.map((r) => [...r.great, ...r.improve]),
          6,
        ).map((t) => ({ theme: t.tag, count: t.count })),
      });
    }
    return out;
  }

  // ---------- admin ----------

  async adminList(
    adminId: string,
    q: AdminFeedbackQuery,
  ): Promise<{ items: AdminFeedbackRow[]; nextCursor: string | null }> {
    const after = q.cursor ? decodeCursor(q.cursor, AdminCursor) : null;
    const res = await this.db.execute<{
      event_id: string;
      n: number;
      avg: number;
      last_at: string | Date;
    }>(q.sort === 'lowest' ? sqlLowest(after, q.limit + 1) : sqlRecent(after, q.limit + 1));
    const page = res.rows.slice(0, q.limit);
    const ids = page.map((r) => r.event_id);
    const [cores, rows, hr] = await Promise.all([
      this.store.coresByIds(ids),
      ids.length
        ? this.db.select().from(eventFeedback).where(inArray(eventFeedback.eventId, ids))
        : Promise.resolve([]),
      ids.length
        ? this.db
            .select({ eventId: hostRatings.eventId, rating: hostRatings.rating })
            .from(hostRatings)
            .where(inArray(hostRatings.eventId, ids))
        : Promise.resolve([]),
    ]);
    const byId = new Map(cores.map((c) => [c.id, c]));
    const cards = await this.people.cards(
      adminId,
      cores.map((c) => c.creatorUserId),
      { includeSelf: true },
    );
    const items = page.flatMap((r) => {
      const core = byId.get(r.event_id);
      const host = core ? cards.get(core.creatorUserId) : undefined;
      if (!core || !host) return [];
      const agg = this.aggregate(
        r.event_id,
        rows.filter((x) => x.eventId === r.event_id),
        hr.filter((x) => x.eventId === r.event_id).map((x) => x.rating),
        false,
      );
      return [
        {
          eventId: r.event_id,
          eventTitle: core.title,
          startsAt: core.startsAt.toISOString(),
          host,
          count: agg.count,
          averageRating: agg.averageRating,
          hostAverage: agg.hostAverage,
          topImprove: agg.improve.slice(0, 3),
        },
      ];
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        res.rows.length > q.limit && last
          ? encodeCursor({
              v: q.sort === 'lowest' ? last.avg : new Date(last.last_at).getTime(),
              id: last.event_id,
            })
          : null,
    };
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(eventFeedback).where(eq(eventFeedback.userId, userId));
    const ratings = await this.db.select().from(hostRatings).where(eq(hostRatings.raterId, userId));
    return {
      feedback: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      hostRatingsGiven: ratings.map((r) => ({ eventId: r.eventId, rating: r.rating })),
    };
  }

  /** Feedback someone gave is theirs and goes; ratings they received as a host go with their account too. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(eventFeedback).where(eq(eventFeedback.userId, userId));
    await tx.delete(hostRatings).where(eq(hostRatings.raterId, userId));
    await tx.delete(hostRatings).where(eq(hostRatings.hostUserId, userId));
  }
}

function sqlRecent(after: { v: number; id: string } | null, limit: number) {
  return sql`
    SELECT event_id, count(*)::int AS n, avg(rating)::float AS avg, max(created_at) AS last_at
    FROM event_feedback GROUP BY event_id
    HAVING ${after ? sql`(max(created_at), event_id) < (${new Date(after.v)}, ${after.id})` : sql`true`}
    ORDER BY max(created_at) DESC, event_id DESC LIMIT ${limit}`;
}

/** Lowest-rated plans with enough answers to mean something. */
function sqlLowest(after: { v: number; id: string } | null, limit: number) {
  return sql`
    SELECT event_id, count(*)::int AS n, avg(rating)::float AS avg, max(created_at) AS last_at
    FROM event_feedback GROUP BY event_id
    HAVING count(*) >= ${LIMITS.after.minRatingsToShow}
      AND ${after ? sql`(avg(rating)::float, event_id) > (${after.v}, ${after.id})` : sql`true`}
    ORDER BY avg(rating) ASC, event_id ASC LIMIT ${limit}`;
}
