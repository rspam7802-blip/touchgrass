import { Inject, Injectable } from '@nestjs/common';
import {
  type ActivityFeed,
  type ActivityItem,
  type ActivityVerb,
  decodeCursor,
  encodeCursor,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DB, DB_REPLICA, type Database } from '../../../infra/database/database.module.js';
import { activityEvents } from '../../../infra/database/schema/index.js';
import type { DbOrTx } from '../../../infra/database/types.js';
import { PeopleService } from '../../profiles/people.service.js';
import { ProfilesService } from '../../profiles/profiles.service.js';
import { SocialGraphService } from '../graph/social-graph.service.js';

export interface ActivityRecord {
  sourceEventId: string;
  actorId: string;
  verb: ActivityVerb;
  subjectUserId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  cityId?: string | null;
}

/**
 * Resolves object titles (events, badges, Lore) for feed rows, for one viewer. Objects the viewer may not see
 * are left out of the map, and their rows are dropped from that viewer's feed.
 */
export type ActivityObjectTitleResolver = (
  viewerId: string,
  ids: string[],
) => Promise<Map<string, string>>;

type ActivityRow = typeof activityEvents.$inferSelect;
const MAX_SCAN_ROUNDS = 5;

/**
 * Squad activity feed (F-SOC-04). Rows are written by worker handlers from domain events (idempotent per
 * source event). Reads show only the viewer's squad, hide blocked people, and respect each person's
 * "share activity" setting for every person mentioned in a row.
 */
@Injectable()
export class ActivityService {
  private readonly titleResolvers = new Map<string, ActivityObjectTitleResolver>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_REPLICA) private readonly replica: Database,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
  ) {}

  registerObjectType(objectType: string, resolver: ActivityObjectTitleResolver): void {
    this.titleResolvers.set(objectType, resolver);
  }

  async record(r: ActivityRecord, db: DbOrTx = this.db): Promise<void> {
    await db
      .insert(activityEvents)
      .values({
        id: uuidv7(),
        actorId: r.actorId,
        verb: r.verb,
        subjectUserId: r.subjectUserId ?? null,
        objectType: r.objectType ?? null,
        objectId: r.objectId ?? null,
        sourceEventId: r.sourceEventId,
        cityId: r.cityId ?? null,
      })
      .onConflictDoNothing();
  }

  async feed(viewerId: string, cursor: string | undefined, limit: number): Promise<ActivityFeed> {
    const friends = await this.graph.friendIds(viewerId);
    if (friends.length === 0) return { items: [], nextCursor: null };
    const blocked = await this.graph.blockedSet(viewerId);
    let after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const collected: ActivityRow[] = [];
    let exhausted = false;

    // Privacy filtering happens after the keyset scan, so scan a few windows to fill a page.
    for (
      let round = 0;
      round < MAX_SCAN_ROUNDS && collected.length < limit && !exhausted;
      round += 1
    ) {
      const batch = await this.replica
        .select()
        .from(activityEvents)
        .where(
          and(
            or(
              inArray(activityEvents.actorId, friends),
              inArray(activityEvents.subjectUserId, friends),
            ),
            sql`${activityEvents.actorId} <> ${viewerId}`,
            sql`${activityEvents.subjectUserId} IS DISTINCT FROM ${viewerId}`,
            after
              ? sql`(${activityEvents.createdAt}, ${activityEvents.id}) < (${new Date(after.t)}, ${after.id}::uuid)`
              : sql`true`,
          ),
        )
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
        .limit(limit * 2);
      if (batch.length < limit * 2) exhausted = true;
      const lastRow = batch[batch.length - 1];
      if (lastRow) after = { t: lastRow.createdAt.toISOString(), id: lastRow.id };
      const people = [
        ...new Set(
          batch.flatMap((r) => (r.subjectUserId ? [r.actorId, r.subjectUserId] : [r.actorId])),
        ),
      ];
      const sharing = await this.profiles.withPrivacyFlag(people, 'shareActivity');
      for (const r of batch) {
        const mentioned = r.subjectUserId ? [r.actorId, r.subjectUserId] : [r.actorId];
        if (mentioned.some((id) => blocked.has(id) || !sharing.has(id))) continue;
        collected.push(r);
        if (collected.length === limit) break;
      }
    }

    const page = collected.slice(0, limit);
    const cards = await this.people.cards(
      viewerId,
      page.flatMap((r) => (r.subjectUserId ? [r.actorId, r.subjectUserId] : [r.actorId])),
    );
    const titles = await this.objectTitles(viewerId, page);
    const items: ActivityItem[] = page.flatMap((r) => {
      const actor = cards.get(r.actorId);
      const subject = r.subjectUserId ? (cards.get(r.subjectUserId) ?? null) : null;
      if (!actor || (r.subjectUserId && !subject)) return [];
      if (
        r.objectType &&
        r.objectId &&
        this.titleResolvers.has(r.objectType) &&
        !titles.has(r.objectId)
      )
        return [];
      const object =
        r.objectType && r.objectId
          ? { type: r.objectType, id: r.objectId, title: titles.get(r.objectId) ?? null }
          : null;
      return [
        { id: r.id, verb: r.verb, actor, subject, object, createdAt: r.createdAt.toISOString() },
      ];
    });
    const last = page[page.length - 1];
    const hasMore = !exhausted || collected.length > limit;
    return {
      items,
      nextCursor:
        hasMore && last && page.length === limit
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async objectTitles(viewerId: string, rows: ActivityRow[]): Promise<Map<string, string>> {
    const byType = new Map<string, string[]>();
    for (const r of rows)
      if (r.objectType && r.objectId)
        byType.set(r.objectType, [...(byType.get(r.objectType) ?? []), r.objectId]);
    const out = new Map<string, string>();
    for (const [type, ids] of byType) {
      const resolver = this.titleResolvers.get(type);
      if (resolver) for (const [id, title] of await resolver(viewerId, ids)) out.set(id, title);
    }
    return out;
  }

  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx
      .delete(activityEvents)
      .where(or(eq(activityEvents.actorId, userId), eq(activityEvents.subjectUserId, userId)));
  }
}
