import { Inject, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  LIMITS,
  type ModerationPreview,
  type PersonCard,
  type PersonStories,
  type PostStoryBody,
  type Story,
  type StoryTray,
  type StoryViewersPage,
  type StoryViewersQuery,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, asc, count, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  mediaAssets,
  stories,
  storyLikes,
  storyViews,
  type VariantKeys,
} from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { MediaService } from '../media/media.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import {
  canLikeStory,
  canSeeStoryStats,
  canViewStory,
  type StoryFacts,
  type StoryViewerFacts,
  trayOrder,
} from './stories.policy.js';

export const STORY_POSTED_EVENT = 'story.posted';
const HOUR_MS = 3_600_000;
/** Upper bound on friend-of-friend candidates considered for one tray (launch scale is far below it). */
const FOF_CANDIDATES = 5000;

type StoryRow = typeof stories.$inferSelect;
interface StoryWithMedia {
  story: StoryRow;
  keys: VariantKeys;
  /** Video stories only. */
  durationMs: number | null;
}

const facts = (s: StoryRow): StoryFacts => ({
  authorId: s.authorId,
  audience: s.audience,
  status: s.status,
  heldAt: s.heldAt,
  expiresAt: s.expiresAt,
});

/**
 * Squad stories (Phase 13): photos that last 24 hours, seen by the author's squad, or squad and friends of
 * friends when the author chooses. Photos go through the normal media pipeline (EXIF/GPS stripped,
 * moderated) and only `ready` ones are shown. Every read re-checks `canViewStory`; blocked people, held
 * captions, expired and removed stories never reach anyone but the author (and removed/expired not even them).
 */
@Injectable()
export class StoriesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly media: MediaService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly graph: SocialGraphService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
    private readonly flags: FeatureFlagsService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- posting ----------

  async post(userId: string, body: PostStoryBody, now: Date = new Date()): Promise<{ id: string }> {
    if (!(await this.flags.isEnabled('stories')))
      throw new AppError('FEATURE_DISABLED', 'Stories are switched off');
    const asset = await this.media.ownedOrThrow(userId, body.mediaId);
    if (asset.purpose !== 'story')
      throw new AppError('VALIDATION_FAILED', 'Upload a story photo first', [
        { path: 'mediaId', message: 'Not a story photo', code: 'custom' },
      ]);
    if (asset.status !== 'ready')
      throw new AppError('MEDIA_NOT_READY', 'Photo is still processing');
    await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body.caption);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stories:${userId}`}))`);
      const [live] = await tx
        .select({ n: count() })
        .from(stories)
        .where(
          and(eq(stories.authorId, userId), eq(stories.status, 'live'), gt(stories.expiresAt, now)),
        );
      if ((live?.n ?? 0) >= LIMITS.stories.maxLivePerAuthor)
        throw new AppError('NOT_ELIGIBLE', 'That is the most stories you can have at once', {
          reason: 'STORY_LIMIT',
        });
      const inserted = await tx
        .insert(stories)
        .values({
          id,
          authorId: userId,
          mediaId: body.mediaId,
          caption: body.caption,
          audience: body.audience,
          heldAt: screen.flagged ? now : null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + LIMITS.stories.lifetimeHours * HOUR_MS),
        })
        .onConflictDoNothing()
        .returning({ id: stories.id });
      if (inserted.length === 0) throw new AppError('CONFLICT', 'That photo is already a story');
      await this.moderation.flagText({ type: 'story', id, cityId: null }, screen, tx);
      await this.outbox.add(tx, {
        aggregateType: 'story',
        aggregateId: id,
        type: STORY_POSTED_EVENT,
        payload: { storyId: id, authorId: userId, audience: body.audience },
      });
    });
    return { id };
  }

  /** Authors delete their own stories; the row and its views and likes go at once, the files right after. */
  async remove(userId: string, storyId: string): Promise<void> {
    const [row] = await this.db
      .delete(stories)
      .where(and(eq(stories.id, storyId), eq(stories.authorId, userId)))
      .returning({ mediaId: stories.mediaId });
    if (!row) throw AppError.notFound('Story');
    await this.media.destroy([row.mediaId]);
  }

  // ---------- reading ----------

  /** How the viewer stands with each author, for `canViewStory`. */
  private async viewerFacts(
    viewerId: string,
    authorIds: string[],
  ): Promise<{ facts: Map<string, StoryViewerFacts>; cards: Map<string, PersonCard> }> {
    const ids = [...new Set(authorIds)];
    const [squad, blocked, cards] = await Promise.all([
      this.graph.friendIds(viewerId),
      this.graph.blockedSet(viewerId),
      // Cards leave out blocked and inactive people, which doubles as the "author active" check.
      this.people.cards(viewerId, ids, { includeSelf: true }),
    ]);
    const squadSet = new Set(squad);
    const fof = await this.graph.friendsOfFriendsAmong(
      viewerId,
      ids.filter((id) => !squadSet.has(id)),
    );
    const out = new Map<string, StoryViewerFacts>();
    for (const id of ids)
      out.set(id, {
        viewerId,
        blocked: blocked.has(id),
        inSquad: squadSet.has(id),
        friendOfFriend: fof.has(id),
        authorActive: cards.has(id),
      });
    return { facts: out, cards };
  }

  /** Live, unexpired stories whose photo is ready, for the given authors (or one story). */
  private async liveRows(
    where: { authorIds: string[] } | { storyId: string },
    now: Date,
  ): Promise<StoryWithMedia[]> {
    if ('authorIds' in where && where.authorIds.length === 0) return [];
    const rows = await this.db
      .select({ story: stories, keys: mediaAssets.variantKeys, durationMs: mediaAssets.durationMs })
      .from(stories)
      .innerJoin(mediaAssets, eq(mediaAssets.id, stories.mediaId))
      .where(
        and(
          'authorIds' in where
            ? inArray(stories.authorId, where.authorIds)
            : eq(stories.id, where.storyId),
          eq(stories.status, 'live'),
          gt(stories.expiresAt, now),
          eq(mediaAssets.status, 'ready'),
        ),
      )
      .orderBy(asc(stories.createdAt), asc(stories.id));
    return rows.flatMap((r) =>
      r.keys ? [{ story: r.story, keys: r.keys, durationMs: r.durationMs }] : [],
    );
  }

  private async seenSet(viewerId: string, storyIds: string[]): Promise<Set<string>> {
    if (storyIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: storyViews.storyId })
      .from(storyViews)
      .where(and(eq(storyViews.viewerId, viewerId), inArray(storyViews.storyId, storyIds)));
    return new Set(rows.map((r) => r.id));
  }

  /** People with stories the viewer may see right now. Empty while the feature is switched off. */
  async tray(viewerId: string, now: Date = new Date()): Promise<StoryTray> {
    if (!(await this.flags.isEnabled('stories'))) return { items: [] };
    const squad = await this.graph.friendIds(viewerId);
    const inner = new Set([viewerId, ...squad]);
    // Friend-of-friend candidates: authors outside the squad who chose the wider audience.
    const wider = await this.db
      .selectDistinct({ authorId: stories.authorId })
      .from(stories)
      .where(
        and(
          eq(stories.status, 'live'),
          eq(stories.audience, 'squad_fof'),
          gt(stories.expiresAt, now),
          sql`${stories.heldAt} IS NULL`,
        ),
      )
      .limit(FOF_CANDIDATES);
    const outer = wider.map((r) => r.authorId).filter((id) => !inner.has(id));
    const rows = await this.liveRows({ authorIds: [...inner, ...outer] }, now);
    const { facts: viewer, cards } = await this.viewerFacts(
      viewerId,
      rows.map((r) => r.story.authorId),
    );
    const visible = rows.filter((r) => {
      const v = viewer.get(r.story.authorId);
      return v !== undefined && canViewStory(facts(r.story), v, now);
    });
    const seen = await this.seenSet(
      viewerId,
      visible.map((r) => r.story.id),
    );
    const byAuthor = new Map<
      string,
      { authorId: string; mine: boolean; unseen: boolean; latestAt: Date; count: number }
    >();
    for (const r of visible) {
      const a = r.story.authorId;
      const mine = a === viewerId;
      const e = byAuthor.get(a) ?? {
        authorId: a,
        mine,
        unseen: false,
        latestAt: r.story.createdAt,
        count: 0,
      };
      e.count += 1;
      if (!mine && !seen.has(r.story.id)) e.unseen = true;
      if (r.story.createdAt > e.latestAt) e.latestAt = r.story.createdAt;
      byAuthor.set(a, e);
    }
    const items = trayOrder([...byAuthor.values()])
      .slice(0, LIMITS.stories.trayMaxAuthors)
      .flatMap((e) => {
        const person = cards.get(e.authorId);
        return person
          ? [
              {
                person,
                mine: e.mine,
                count: e.count,
                unseen: e.unseen,
                latestAt: e.latestAt.toISOString(),
              },
            ]
          : [];
      });
    return { items };
  }

  /** One person's live stories the viewer may see, oldest first. Not found when there are none to see. */
  async forPerson(
    viewerId: string,
    authorId: string,
    now: Date = new Date(),
  ): Promise<PersonStories> {
    const rows = await this.liveRows({ authorIds: [authorId] }, now);
    const { facts: viewer, cards } = await this.viewerFacts(viewerId, [authorId]);
    const v = viewer.get(authorId);
    const person = cards.get(authorId);
    const visible = v ? rows.filter((r) => canViewStory(facts(r.story), v, now)) : [];
    if (!person || visible.length === 0) throw AppError.notFound('Stories');
    const ids = visible.map((r) => r.story.id);
    const mine = authorId === viewerId;
    const [seen, liked, stats] = await Promise.all([
      this.seenSet(viewerId, ids),
      this.likedSet(viewerId, ids),
      mine ? this.stats(ids) : Promise.resolve(null),
    ]);
    const items: Story[] = [];
    for (const r of visible) {
      const image = await this.media.urlsFor(r.keys, now);
      if (!image) continue;
      items.push({
        id: r.story.id,
        image,
        video: await this.media.videoFor(r.keys, r.durationMs, now),
        caption: r.story.caption,
        createdAt: r.story.createdAt.toISOString(),
        expiresAt: r.story.expiresAt.toISOString(),
        seen: mine || seen.has(r.story.id),
        liked: liked.has(r.story.id),
        mine,
        audience: mine ? r.story.audience : null,
        held: mine && r.story.heldAt !== null,
        viewCount: stats ? (stats.views.get(r.story.id) ?? 0) : null,
        likeCount: stats ? (stats.likes.get(r.story.id) ?? 0) : null,
      });
    }
    return { person, items };
  }

  private async likedSet(userId: string, storyIds: string[]): Promise<Set<string>> {
    if (storyIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: storyLikes.storyId })
      .from(storyLikes)
      .where(and(eq(storyLikes.userId, userId), inArray(storyLikes.storyId, storyIds)));
    return new Set(rows.map((r) => r.id));
  }

  private async stats(
    storyIds: string[],
  ): Promise<{ views: Map<string, number>; likes: Map<string, number> }> {
    const [views, likes] = await Promise.all([
      this.db
        .select({ id: storyViews.storyId, n: count() })
        .from(storyViews)
        .where(inArray(storyViews.storyId, storyIds))
        .groupBy(storyViews.storyId),
      this.db
        .select({ id: storyLikes.storyId, n: count() })
        .from(storyLikes)
        .where(inArray(storyLikes.storyId, storyIds))
        .groupBy(storyLikes.storyId),
    ]);
    return {
      views: new Map(views.map((r) => [r.id, r.n])),
      likes: new Map(likes.map((r) => [r.id, r.n])),
    };
  }

  /** A story the viewer may see, with the facts used to decide (not found otherwise: no existence leak). */
  private async visibleOrThrow(
    viewerId: string,
    storyId: string,
    now: Date,
  ): Promise<{ row: StoryWithMedia; viewer: StoryViewerFacts }> {
    const [row] = await this.liveRows({ storyId }, now);
    if (!row) throw AppError.notFound('Story');
    const { facts: viewers } = await this.viewerFacts(viewerId, [row.story.authorId]);
    const viewer = viewers.get(row.story.authorId);
    if (!viewer || !canViewStory(facts(row.story), viewer, now)) throw AppError.notFound('Story');
    return { row, viewer };
  }

  // ---------- views and likes ----------

  /** Records that the viewer opened the story (authors' own views are not counted). */
  async markViewed(viewerId: string, storyId: string, now: Date = new Date()): Promise<void> {
    const { row } = await this.visibleOrThrow(viewerId, storyId, now);
    if (row.story.authorId === viewerId) return;
    await this.db
      .insert(storyViews)
      .values({ storyId, viewerId, viewedAt: now })
      .onConflictDoNothing();
  }

  async like(userId: string, storyId: string, now: Date = new Date()): Promise<void> {
    const { row, viewer } = await this.visibleOrThrow(userId, storyId, now);
    if (!canLikeStory(facts(row.story), viewer, now))
      throw new AppError('VALIDATION_FAILED', 'You cannot like your own story');
    await this.db.transaction(async (tx) => {
      await tx
        .insert(storyViews)
        .values({ storyId, viewerId: userId, viewedAt: now })
        .onConflictDoNothing();
      await tx.insert(storyLikes).values({ storyId, userId, createdAt: now }).onConflictDoNothing();
    });
  }

  /** Taking a like back always works, even once the story is gone from view. */
  async unlike(userId: string, storyId: string): Promise<void> {
    await this.db
      .delete(storyLikes)
      .where(and(eq(storyLikes.storyId, storyId), eq(storyLikes.userId, userId)));
  }

  /** Author only: who opened the story, newest first, with whether they liked it. */
  async viewers(
    authorId: string,
    storyId: string,
    q: StoryViewersQuery,
    now: Date = new Date(),
  ): Promise<StoryViewersPage> {
    const [row] = await this.liveRows({ storyId }, now);
    if (!row || !canSeeStoryStats(row.story, authorId)) throw AppError.notFound('Story');
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select({
        viewerId: storyViews.viewerId,
        viewedAt: storyViews.viewedAt,
        liked: sql<boolean>`${storyLikes.userId} IS NOT NULL`,
      })
      .from(storyViews)
      .leftJoin(
        storyLikes,
        and(eq(storyLikes.storyId, storyViews.storyId), eq(storyLikes.userId, storyViews.viewerId)),
      )
      .where(
        and(
          eq(storyViews.storyId, storyId),
          ne(storyViews.viewerId, authorId),
          after
            ? or(
                lt(storyViews.viewedAt, new Date(after.t)),
                and(eq(storyViews.viewedAt, new Date(after.t)), lt(storyViews.viewerId, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(storyViews.viewedAt), desc(storyViews.viewerId))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const cards = await this.people.cards(
      authorId,
      page.map((r) => r.viewerId),
    );
    const last = page[page.length - 1];
    return {
      items: page.flatMap((r) => {
        const person = cards.get(r.viewerId);
        return person ? [{ person, liked: r.liked, viewedAt: r.viewedAt.toISOString() }] : [];
      }),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.viewedAt.toISOString(), id: last.viewerId })
          : null,
    };
  }

  // ---------- reports and moderation (F-SAF-05, F-SAF-06) ----------

  /** Report target 'story': the reporter must be able to see it. */
  async reportTarget(
    reporterId: string,
    storyId: string,
  ): Promise<{ cityId: string | null; ownerUserId: string | null } | null> {
    try {
      const { row } = await this.visibleOrThrow(reporterId, storyId, new Date());
      if (row.story.authorId === reporterId) return null;
      return { cityId: null, ownerUserId: row.story.authorId };
    } catch {
      return null;
    }
  }

  async moderationPreview(storyId: string): Promise<ModerationPreview> {
    const [row] = await this.db
      .select({ story: stories, keys: mediaAssets.variantKeys })
      .from(stories)
      .innerJoin(mediaAssets, eq(mediaAssets.id, stories.mediaId))
      .where(eq(stories.id, storyId));
    if (!row || row.story.status !== 'live') return GONE;
    const names = await this.profiles.displayNames([row.story.authorId]);
    return {
      title: 'Story',
      text: row.story.caption || null,
      image: await this.media.urlsFor(row.keys),
      owner: { id: row.story.authorId, displayName: names.get(row.story.authorId) ?? '' },
      gone: false,
    };
  }

  async release(storyId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(stories).set({ heldAt: null }).where(eq(stories.id, storyId));
    return undefined;
  }

  /** Takes the story down for everyone; its files go once the decision has committed. */
  async removeForModeration(storyId: string, tx: Tx): Promise<AfterCommit> {
    const [row] = await tx
      .update(stories)
      .set({ status: 'removed', heldAt: null })
      .where(and(eq(stories.id, storyId), eq(stories.status, 'live')))
      .returning({ mediaId: stories.mediaId });
    return row ? () => this.media.destroy([row.mediaId]) : undefined;
  }

  // ---------- housekeeping ----------

  /**
   * Worker (hourly): deletes stories that expired (or were taken down) more than the grace period ago,
   * with their views, likes and files. The grace keeps reports filed just before expiry reviewable.
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - LIMITS.stories.purgeGraceHours * HOUR_MS);
    const due = await this.db
      .select({ id: stories.id, mediaId: stories.mediaId })
      .from(stories)
      .where(
        or(
          lt(stories.expiresAt, cutoff),
          and(eq(stories.status, 'removed'), lt(stories.updatedAt, cutoff)),
        ),
      )
      .limit(500);
    if (due.length === 0) return 0;
    // Files first: if the delete below fails, the next run finds the rows again.
    await this.media.destroy(due.map((r) => r.mediaId));
    await this.db.delete(stories).where(
      inArray(
        stories.id,
        due.map((r) => r.id),
      ),
    );
    return due.length;
  }

  /** Worker, hourly: story photos uploaded but never posted are deleted after a day. */
  async purgeUnpostedMedia(now: Date = new Date()): Promise<number> {
    return this.media.purgeUnused(
      'story',
      new Date(now.getTime() - 24 * HOUR_MS),
      async (ids) =>
        new Set(
          (
            await this.db
              .select({ id: stories.mediaId })
              .from(stories)
              .where(inArray(stories.mediaId, ids))
          ).map((r) => r.id),
        ),
    );
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [mine, likes, views] = await Promise.all([
      this.db.select().from(stories).where(eq(stories.authorId, userId)),
      this.db.select().from(storyLikes).where(eq(storyLikes.userId, userId)),
      this.db.select().from(storyViews).where(eq(storyViews.viewerId, userId)),
    ]);
    return {
      stories: mine.map((s) => ({
        id: s.id,
        mediaId: s.mediaId,
        caption: s.caption,
        audience: s.audience,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
      storyLikes: likes.map((l) => ({ storyId: l.storyId, at: l.createdAt.toISOString() })),
      storyViews: views.map((v) => ({ storyId: v.storyId, at: v.viewedAt.toISOString() })),
    };
  }

  /** Their stories (with everyone's views and likes of them) and their own views and likes go. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(stories).where(eq(stories.authorId, userId));
    await tx.delete(storyLikes).where(eq(storyLikes.userId, userId));
    await tx.delete(storyViews).where(eq(storyViews.viewerId, userId));
  }
}
