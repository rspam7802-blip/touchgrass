import { Inject, Injectable } from '@nestjs/common';
import {
  type AddLoreBody,
  decodeCursor,
  encodeCursor,
  LIMITS,
  type LoreAlbum,
  type LoreDownload,
  type LoreItem,
  type LoreQuery,
  type LoreVisibility,
  type ModerationPreview,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { loreAlbums, loreItems, mediaAssets } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import type { EventViewerFacts } from '../events/event-access.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { MediaProcessor } from '../media/media.processor.js';
import { MediaService } from '../media/media.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { coverSource, loreAccess } from './lore.policy.js';

export const LORE_ADDED_EVENT = 'lore.added';
export const LORE_CHANGED_EVENT = 'lore.changed';
const COLLAGE_TILE = 540;

type ItemRow = typeof loreItems.$inferSelect;

/**
 * Lore (F-AFT-04): a shared photo album per plan. People who checked in (and hosts) add photos, which go
 * through the normal media pipeline (EXIF stripped, moderated) and appear once ready. Hosts choose whether
 * attendees' squads can see it too. Blocked people's photos are never shown or downloadable.
 */
@Injectable()
export class LoreService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: EventAccessService,
    private readonly store: EventStore,
    private readonly search: EventSearchService,
    private readonly media: MediaService,
    private readonly processor: MediaProcessor,
    private readonly people: PeopleService,
    private readonly graph: SocialGraphService,
    private readonly outbox: OutboxService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
    private readonly profiles: ProfilesService,
  ) {}

  private async visibility(
    eventId: string,
  ): Promise<{ visibility: LoreVisibility; coverMediaId: string | null }> {
    const [a] = await this.db.select().from(loreAlbums).where(eq(loreAlbums.eventId, eventId));
    return { visibility: a?.visibility ?? 'attendees', coverMediaId: a?.coverMediaId ?? null };
  }

  private async rights(userId: string, core: EventCore, facts: EventViewerFacts, now: Date) {
    const { visibility } = await this.visibility(core.id);
    const attended = facts.rsvp === 'checked_in';
    let squadOfAttendee = false;
    if (!attended && facts.hostRole === null && visibility === 'friends_of_attendees') {
      const attendees = await this.search.checkedInAndHosts(core.id);
      const squad = new Set(await this.graph.friendIds(userId));
      squadOfAttendee = attendees.some((id) => squad.has(id));
    }
    return {
      visibility,
      ...loreAccess(
        { attended, isHost: facts.hostRole !== null, squadOfAttendee },
        core,
        visibility,
        now,
      ),
    };
  }

  private async open(userId: string, eventId: string, now: Date) {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    const r = await this.rights(userId, core, facts, now);
    if (!r.view) throw AppError.notFound('Lore');
    return { core, facts, ...r };
  }

  /** Items the viewer may see: visible, media ready, uploader not blocked either way. */
  private async visibleItems(
    viewerId: string,
    eventId: string,
    page: { after: { t: string; id: string } | null; limit: number } | null,
  ): Promise<{ item: ItemRow; keys: NonNullable<typeof mediaAssets.$inferSelect.variantKeys> }[]> {
    const blocked = [...(await this.graph.blockedSet(viewerId))];
    const rows = await this.db
      .select({ item: loreItems, keys: mediaAssets.variantKeys })
      .from(loreItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, loreItems.mediaId))
      .where(
        and(
          eq(loreItems.eventId, eventId),
          eq(loreItems.status, 'visible'),
          eq(mediaAssets.status, 'ready'),
          blocked.length > 0
            ? or(
                sql`${loreItems.uploaderId} IS NULL`,
                sql`NOT (${inArray(loreItems.uploaderId, blocked)})`,
              )
            : undefined,
          page?.after
            ? or(
                lt(loreItems.createdAt, new Date(page.after.t)),
                and(
                  eq(loreItems.createdAt, new Date(page.after.t)),
                  lt(loreItems.id, page.after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(loreItems.createdAt), desc(loreItems.id))
      .limit(page ? page.limit + 1 : 1000);
    return rows.flatMap((r) => (r.keys ? [{ item: r.item, keys: r.keys }] : []));
  }

  async album(
    viewerId: string,
    eventId: string,
    q: LoreQuery,
    now: Date = new Date(),
  ): Promise<LoreAlbum> {
    const { core, visibility, add, manage } = await this.open(viewerId, eventId, now);
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const rows = await this.visibleItems(viewerId, eventId, { after, limit: q.limit });
    const page = rows.slice(0, q.limit);
    const [cards, total, cover] = await Promise.all([
      this.people.cards(
        viewerId,
        page.flatMap((r) => (r.item.uploaderId ? [r.item.uploaderId] : [])),
        { includeSelf: true },
      ),
      this.countVisible(eventId),
      this.coverUrls(eventId),
    ]);
    const items: LoreItem[] = [];
    for (const r of page) {
      const uploader = r.item.uploaderId ? cards.get(r.item.uploaderId) : undefined;
      const image = await this.media.urlsFor(r.keys);
      if (!uploader || !image) continue;
      items.push({
        id: r.item.id,
        image,
        caption: r.item.captionHeldAt && r.item.uploaderId !== viewerId ? '' : r.item.caption,
        captionHeld: r.item.captionHeldAt !== null && r.item.uploaderId === viewerId,
        uploader,
        mine: r.item.uploaderId === viewerId,
        createdAt: r.item.createdAt.toISOString(),
      });
    }
    const last = page[page.length - 1];
    return {
      eventId,
      eventTitle: core.title,
      visibility,
      cover,
      count: total,
      canAdd: add,
      canManage: manage,
      items,
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.item.createdAt.toISOString(), id: last.item.id })
          : null,
    };
  }

  private async countVisible(eventId: string, db: Database | Tx = this.db): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(loreItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, loreItems.mediaId))
      .where(
        and(
          eq(loreItems.eventId, eventId),
          eq(loreItems.status, 'visible'),
          eq(mediaAssets.status, 'ready'),
        ),
      );
    return row?.n ?? 0;
  }

  private async coverUrls(eventId: string) {
    const { coverMediaId } = await this.visibility(eventId);
    if (!coverMediaId) return null;
    const asset = await this.media.byId(coverMediaId);
    return asset?.status === 'ready' ? this.media.urlsFor(asset.variantKeys) : null;
  }

  /** Event detail hook: album size and whether the viewer can add, or null when they cannot see it. */
  async summaryFor(
    userId: string,
    core: EventCore,
    facts: EventViewerFacts,
    now: Date = new Date(),
  ): Promise<{ count: number; canAdd: boolean } | null> {
    const r = await this.rights(userId, core, facts, now);
    return r.view ? { count: await this.countVisible(core.id), canAdd: r.add } : null;
  }

  async add(
    userId: string,
    eventId: string,
    body: AddLoreBody,
    now: Date = new Date(),
  ): Promise<{ id: string }> {
    const { core, add } = await this.open(userId, eventId, now);
    if (!add)
      throw new AppError('NOT_ELIGIBLE', 'Only people who were there add Lore', {
        reason: 'NOT_ATTENDED',
      });
    const asset = await this.media.ownedOrThrow(userId, body.mediaId);
    if (asset.purpose !== 'lore')
      throw new AppError('VALIDATION_FAILED', 'Upload a Lore photo first', [
        { path: 'mediaId', message: 'Not a Lore photo', code: 'custom' },
      ]);
    // Only processed, moderated photos join an album (the app waits for `ready`, as for chat photos).
    if (asset.status !== 'ready')
      throw new AppError('MEDIA_NOT_READY', 'Photo is still processing');
    await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body.caption);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lore:${eventId}:${userId}`}))`);
      const [mine] = await tx
        .select({ n: count() })
        .from(loreItems)
        .where(
          and(
            eq(loreItems.eventId, eventId),
            eq(loreItems.uploaderId, userId),
            eq(loreItems.status, 'visible'),
          ),
        );
      if ((mine?.n ?? 0) >= LIMITS.after.lorePerPersonPerEvent)
        throw new AppError('NOT_ELIGIBLE', 'That is the most photos you can add here', {
          reason: 'LORE_LIMIT',
        });
      await tx.insert(loreAlbums).values({ eventId }).onConflictDoNothing();
      const inserted = await tx
        .insert(loreItems)
        .values({
          id,
          eventId,
          mediaId: body.mediaId,
          uploaderId: userId,
          caption: body.caption,
          captionHeldAt: screen.flagged ? now : null,
        })
        .onConflictDoNothing()
        .returning({ id: loreItems.id });
      if (inserted.length === 0) throw new AppError('CONFLICT', 'That photo is already in Lore');
      await this.moderation.flagText({ type: 'lore_media', id, cityId: core.cityId }, screen, tx);
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: eventId,
        type: LORE_ADDED_EVENT,
        // Decided here, under the per-person lock: relay lag must not hide someone's first photo.
        payload: {
          eventId,
          itemId: id,
          uploaderId: userId,
          cityId: core.cityId,
          first: (mine?.n ?? 0) === 0,
        },
      });
    });
    return { id };
  }

  /** Uploaders remove their own photos; hosts can remove any photo from their plan's album. */
  async remove(userId: string, itemId: string): Promise<void> {
    const [item] = await this.db.select().from(loreItems).where(eq(loreItems.id, itemId));
    if (!item || item.status !== 'visible') throw AppError.notFound('Photo');
    if (item.uploaderId !== userId) {
      const { facts } = await this.access.visibleOrThrow(userId, item.eventId);
      if (facts.hostRole === null || facts.hostRole === 'welcome_host')
        throw AppError.notFound('Photo');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(loreItems)
        .set({ status: 'removed', removedByUserId: userId })
        .where(eq(loreItems.id, itemId));
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: item.eventId,
        type: LORE_CHANGED_EVENT,
        payload: { eventId: item.eventId },
      });
    });
  }

  async setVisibility(hostId: string, eventId: string, visibility: LoreVisibility): Promise<void> {
    await this.access.requireHost(hostId, eventId, { roles: ['host', 'co_host'] });
    await this.db
      .insert(loreAlbums)
      .values({ eventId, visibility })
      .onConflictDoUpdate({ target: loreAlbums.eventId, set: { visibility } });
  }

  /** Full-size, short-lived links to what this viewer may see (never blocked people's photos). */
  async download(viewerId: string, eventId: string, now: Date = new Date()): Promise<LoreDownload> {
    await this.open(viewerId, eventId, now);
    const ttl = LIMITS.after.loreDownloadTtlSeconds;
    const rows = await this.visibleItems(viewerId, eventId, null);
    const items = await Promise.all(
      rows.map(async (r) => ({ id: r.item.id, url: await this.media.downloadUrl(r.keys, ttl) })),
    );
    return { items, expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() };
  }

  /** Report target 'lore_media': the reporter must be able to see it. */
  async reportTarget(
    reporterId: string,
    itemId: string,
  ): Promise<{ cityId: string | null; ownerUserId: string | null } | null> {
    const [item] = await this.db.select().from(loreItems).where(eq(loreItems.id, itemId));
    if (!item || item.status !== 'visible') return null;
    try {
      const { core } = await this.open(reporterId, item.eventId, new Date());
      return { cityId: core.cityId, ownerUserId: item.uploaderId };
    } catch {
      return null;
    }
  }

  // ---------- moderation (F-SAF-05, F-SAF-06) ----------

  async moderationPreview(itemId: string): Promise<ModerationPreview> {
    const [row] = await this.db
      .select({ item: loreItems, keys: mediaAssets.variantKeys })
      .from(loreItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, loreItems.mediaId))
      .where(eq(loreItems.id, itemId));
    if (!row || row.item.status !== 'visible') return GONE;
    const [core, names] = await Promise.all([
      this.store.core(row.item.eventId),
      this.profiles.displayNames(row.item.uploaderId ? [row.item.uploaderId] : []),
    ]);
    return {
      title: core?.title ?? '',
      text: row.item.caption || null,
      image: await this.media.urlsFor(row.keys),
      owner: row.item.uploaderId
        ? { id: row.item.uploaderId, displayName: names.get(row.item.uploaderId) ?? '' }
        : null,
      gone: false,
    };
  }

  async releaseCaption(itemId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(loreItems).set({ captionHeldAt: null }).where(eq(loreItems.id, itemId));
    return undefined;
  }

  /** Takes the photo out of the album (the cover is redrawn by the worker). */
  async removeForModeration(itemId: string, tx: Tx): Promise<AfterCommit> {
    const [item] = await tx
      .update(loreItems)
      .set({ status: 'removed', captionHeldAt: null })
      .where(and(eq(loreItems.id, itemId), eq(loreItems.status, 'visible')))
      .returning({ eventId: loreItems.eventId });
    if (item)
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: item.eventId,
        type: LORE_CHANGED_EVENT,
        payload: { eventId: item.eventId },
      });
    return undefined;
  }

  /**
   * Worker (after Lore changes): redraws the album cover as a 2×2 collage of the four newest visible photos,
   * only when that set changed. No photos → no cover.
   */
  async refreshCover(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: loreItems.id, keys: mediaAssets.variantKeys })
      .from(loreItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, loreItems.mediaId))
      .where(
        and(
          eq(loreItems.eventId, eventId),
          eq(loreItems.status, 'visible'),
          eq(mediaAssets.status, 'ready'),
        ),
      )
      .orderBy(desc(loreItems.createdAt), desc(loreItems.id))
      .limit(4);
    const source = coverSource(rows.map((r) => r.id));
    const [album] = await this.db.select().from(loreAlbums).where(eq(loreAlbums.eventId, eventId));
    if (album?.coverSource === source) return false;
    let coverId: string | null = null;
    if (rows.length > 0) {
      const usable: Buffer[] = [];
      for (const r of rows) {
        if (!r.keys) continue;
        usable.push(
          await sharp(await this.media.readVariant(r.keys, 'md'))
            .resize(COLLAGE_TILE, COLLAGE_TILE, { fit: 'cover' })
            .toBuffer(),
        );
      }
      const size = usable.length === 1 ? COLLAGE_TILE : COLLAGE_TILE * 2;
      const collage = await sharp({
        create: { width: size, height: size, channels: 3, background: { r: 16, g: 32, b: 24 } },
      })
        .composite(
          usable.map((input, i) => ({
            input,
            left: (i % 2) * COLLAGE_TILE,
            top: usable.length === 1 ? 0 : Math.floor(i / 2) * COLLAGE_TILE,
          })),
        )
        .webp({ quality: 85 })
        .toBuffer();
      coverId = await this.processor.storeGenerated('lore', null, collage);
    }
    await this.db
      .insert(loreAlbums)
      .values({ eventId, coverMediaId: coverId, coverSource: source })
      .onConflictDoUpdate({
        target: loreAlbums.eventId,
        set: { coverMediaId: coverId, coverSource: source },
      });
    if (album?.coverMediaId) await this.media.destroy([album.coverMediaId]);
    return true;
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(loreItems).where(eq(loreItems.uploaderId, userId));
    return {
      lore: rows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        mediaId: r.mediaId,
        caption: r.caption,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Their photos leave every album (the media module deletes the files); covers are redrawn by the worker. */
  async eraseFor(userId: string, tx: Tx): Promise<string[]> {
    const rows = await tx
      .delete(loreItems)
      .where(eq(loreItems.uploaderId, userId))
      .returning({ eventId: loreItems.eventId });
    const events = [...new Set(rows.map((r) => r.eventId))];
    for (const eventId of events)
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: eventId,
        type: LORE_CHANGED_EVENT,
        payload: { eventId },
      });
    await tx
      .update(loreItems)
      .set({ removedByUserId: null })
      .where(eq(loreItems.removedByUserId, userId));
    return events;
  }
}
