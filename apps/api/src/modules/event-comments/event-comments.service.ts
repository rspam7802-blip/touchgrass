import { Inject, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type EventComment,
  type EventCommentPage,
  type EventCommentsQuery,
  type ModerationPreview,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { eventComments } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { canViewEvent } from '../events/event.policy.js';
import { EventStore } from '../events/event-store.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { canComment, canDeleteComment, commentVisibleTo } from './event-comments.policy.js';

export const EVENT_COMMENTED_EVENT = 'event.commented';

type Row = typeof eventComments.$inferSelect;

/**
 * Comments on a plan (D-156): questions and chatter in the open, for everyone who can see the plan. Every
 * read goes through the plan's own visibility (`canViewEvent`), so a comment never reaches someone the plan
 * is hidden from. Text is screened (held, not rejected), muted people can't post, and comments can be
 * reported and taken down from the moderation queue.
 */
@Injectable()
export class EventCommentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: EventAccessService,
    private readonly store: EventStore,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly graph: SocialGraphService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
    private readonly outbox: OutboxService,
  ) {}

  async list(viewerId: string, eventId: string, q: EventCommentsQuery): Promise<EventCommentPage> {
    const { core, facts } = await this.access.visibleOrThrow(viewerId, eventId);
    const blocked = await this.graph.blockedSet(viewerId);
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(eventComments)
      .where(
        and(
          eq(eventComments.eventId, eventId),
          eq(eventComments.status, 'visible'),
          // Others' held comments never leave the database for this viewer.
          or(sql`${eventComments.heldAt} IS NULL`, eq(eventComments.authorId, viewerId)),
          after
            ? or(
                lt(eventComments.createdAt, new Date(after.t)),
                and(eq(eventComments.createdAt, new Date(after.t)), lt(eventComments.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(eventComments.createdAt), desc(eventComments.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const visible = page.filter((r) => commentVisibleTo(r, viewerId, blocked));
    const hostIds = new Set(facts.hosts.map((h) => h.userId));
    const viewerHosts = facts.hostRole !== null;
    const cards = await this.people.cards(
      viewerId,
      visible.map((r) => r.authorId),
      { includeSelf: true },
    );
    const items: EventComment[] = visible.flatMap((r) => {
      const author = cards.get(r.authorId);
      return author
        ? [
            {
              id: r.id,
              author,
              body: r.body,
              createdAt: r.createdAt.toISOString(),
              mine: r.authorId === viewerId,
              fromHost: hostIds.has(r.authorId),
              held: r.authorId === viewerId && r.heldAt !== null,
              canDelete: canDeleteComment(r, viewerId, viewerHosts),
            },
          ]
        : [];
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
      canComment: canComment(core, true),
    };
  }

  async post(
    userId: string,
    eventId: string,
    body: string,
    now: Date = new Date(),
  ): Promise<EventComment> {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    if (!canComment(core, true))
      throw new AppError('NOT_ELIGIBLE', 'This plan is not taking comments', {
        reason: 'COMMENTS_CLOSED',
      });
    await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(eventComments).values({
        id,
        eventId,
        authorId: userId,
        body,
        heldAt: screen.flagged ? now : null,
        createdAt: now,
      });
      await this.moderation.flagText(
        { type: 'event_comment', id, cityId: core.cityId },
        screen,
        tx,
      );
      // Held comments don't notify anyone until a moderator releases them.
      if (!screen.flagged)
        await this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: eventId,
          type: EVENT_COMMENTED_EVENT,
          payload: { eventId, commentId: id, authorId: userId },
        });
    });
    const author = (await this.people.cards(userId, [userId], { includeSelf: true })).get(userId);
    if (!author) throw AppError.notFound('Profile');
    return {
      id,
      author,
      body,
      createdAt: now.toISOString(),
      mine: true,
      fromHost: facts.hostRole !== null,
      held: screen.flagged,
      canDelete: true,
    };
  }

  /** Authors remove their own; hosts remove any on their plan. Others get not found. */
  async remove(userId: string, commentId: string): Promise<void> {
    const [row] = await this.db.select().from(eventComments).where(eq(eventComments.id, commentId));
    if (!row || row.status !== 'visible') throw AppError.notFound('Comment');
    let hosts = false;
    if (row.authorId !== userId) {
      const { facts } = await this.access.visibleOrThrow(userId, row.eventId);
      hosts = facts.hostRole !== null;
    }
    if (!canDeleteComment(row, userId, hosts)) throw AppError.notFound('Comment');
    await this.db
      .update(eventComments)
      .set({ status: 'removed' })
      .where(eq(eventComments.id, commentId));
  }

  /** Worker: tells the plan's hosts about a new comment (never the author, never across a block). */
  async hostAudience(
    eventId: string,
    commentId: string,
  ): Promise<{
    userIds: string[];
    authorId: string;
    title: string;
    excerpt: string;
  } | null> {
    const [row] = await this.db.select().from(eventComments).where(eq(eventComments.id, commentId));
    if (!row || row.status !== 'visible' || row.heldAt !== null) return null;
    const core = await this.store.core(eventId);
    if (!core) return null;
    const hosts = (await this.store.hosts(eventId)).map((h) => h.userId);
    const blocked = await this.graph.blockedSet(row.authorId);
    const userIds = hosts.filter((h) => h !== row.authorId && !blocked.has(h));
    return {
      userIds,
      authorId: row.authorId,
      title: core.title,
      excerpt: row.body.length > 120 ? `${row.body.slice(0, 117)}…` : row.body,
    };
  }

  // ---------- reports and moderation (F-SAF-05, F-SAF-06) ----------

  async reportTarget(
    reporterId: string,
    commentId: string,
  ): Promise<{ cityId: string | null; ownerUserId: string | null } | null> {
    const [row] = await this.db.select().from(eventComments).where(eq(eventComments.id, commentId));
    if (!row || row.status !== 'visible' || row.authorId === reporterId) return null;
    const core = await this.store.core(row.eventId);
    if (!core) return null;
    const ctx = await this.access.context(reporterId);
    const facts = await this.access.facts(ctx, row.eventId);
    const blocked = await this.graph.blockedSet(reporterId);
    if (!canViewEvent(facts, core) || !commentVisibleTo(row, reporterId, blocked)) return null;
    return { cityId: core.cityId, ownerUserId: row.authorId };
  }

  async moderationPreview(commentId: string): Promise<ModerationPreview> {
    const [row] = await this.db.select().from(eventComments).where(eq(eventComments.id, commentId));
    if (!row || row.status !== 'visible') return GONE;
    const [core, names] = await Promise.all([
      this.store.core(row.eventId),
      this.profiles.displayNames([row.authorId]),
    ]);
    return {
      title: core?.title ?? '',
      text: row.body,
      image: null,
      owner: { id: row.authorId, displayName: names.get(row.authorId) ?? '' },
      gone: false,
    };
  }

  async release(commentId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(eventComments).set({ heldAt: null }).where(eq(eventComments.id, commentId));
    return undefined;
  }

  async removeForModeration(commentId: string, tx: Tx): Promise<AfterCommit> {
    await tx
      .update(eventComments)
      .set({ status: 'removed', heldAt: null })
      .where(eq(eventComments.id, commentId));
    return undefined;
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(eventComments)
      .where(eq(eventComments.authorId, userId));
    return {
      eventComments: rows.map((r: Row) => ({
        id: r.id,
        eventId: r.eventId,
        body: r.body,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(eventComments).where(eq(eventComments.authorId, userId));
  }
}
