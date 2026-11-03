import { Inject, Injectable } from '@nestjs/common';
import type { RelationshipStatus } from '@touchgrass/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppError } from '../../../common/errors/app-error.js';
import { DB, DB_REPLICA, type Database } from '../../../infra/database/database.module.js';
import {
  blocks,
  contactHashes,
  friendships,
  squadEdges,
  suggestionDismissals,
} from '../../../infra/database/schema/index.js';
import type { DbOrTx } from '../../../infra/database/types.js';
import { OutboxService } from '../../../infra/outbox/outbox.service.js';
import { REDIS } from '../../../infra/redis/redis.module.js';
import type { Relationship } from '../../profiles/profile.policy.js';
import {
  decideRequest,
  type FriendshipState,
  orderedPair,
  relationshipFrom,
} from './friendship.policy.js';

export const FRIEND_REQUESTED_EVENT = 'friendship.requested';
export const FRIEND_ACCEPTED_EVENT = 'friendship.accepted';
export const FRIEND_REMOVED_EVENT = 'friendship.removed';
export const USER_BLOCKED_EVENT = 'user.blocked';

const BLOCK_CACHE_TTL = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One bound parameter holding a Postgres array literal (drizzle would otherwise spread JS arrays). */
export function uuidArrayLiteral(ids: string[]): string {
  for (const id of ids) if (!UUID.test(id)) throw new AppError('VALIDATION_FAILED', 'Invalid id');
  return `{${ids.join(',')}}`;
}

/**
 * Owns friendships, blocks, contact hashes and suggestion dismissals (F-SOC-01/02/05).
 * Every other module asks this service; nobody else reads these tables.
 */
@Injectable()
export class SocialGraphService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_REPLICA) private readonly replica: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly outbox: OutboxService,
  ) {}

  private async pairRow(
    a: string,
    b: string,
    db: DbOrTx,
    lock = false,
  ): Promise<FriendshipState | null> {
    const [low, high] = orderedPair(a, b);
    const q = db
      .select({
        status: friendships.status,
        requesterId: friendships.requesterId,
        respondedAt: friendships.respondedAt,
      })
      .from(friendships)
      .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)))
      .limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row ?? null;
  }

  // ---------- blocks ----------

  /** Everyone this user has blocked or been blocked by (cached; invalidated on every block change). */
  async blockedSet(userId: string): Promise<Set<string>> {
    const key = `blocks:${userId}`;
    const cached = await this.redis.get(key);
    if (cached !== null) return new Set(JSON.parse(cached) as string[]);
    const rows = await this.db
      .select({ a: blocks.blockerId, b: blocks.blockedId })
      .from(blocks)
      .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
    const ids = rows.map((r) => (r.a === userId ? r.b : r.a));
    await this.redis.set(key, JSON.stringify(ids), 'EX', BLOCK_CACHE_TTL);
    return new Set(ids);
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    return (await this.blockedSet(a)).has(b);
  }

  /** Blocking also ends any friendship or pending request between the two (F-SOC-05). */
  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId)
      throw new AppError('VALIDATION_FAILED', 'You cannot block yourself');
    const [low, high] = orderedPair(blockerId, blockedId);
    await this.db.transaction(async (tx) => {
      await tx.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();
      await tx
        .update(friendships)
        .set({ status: 'cancelled', respondedAt: new Date() })
        .where(
          and(
            eq(friendships.userLow, low),
            eq(friendships.userHigh, high),
            inArray(friendships.status, ['pending', 'accepted']),
          ),
        );
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: blockerId,
        type: USER_BLOCKED_EVENT,
        payload: { blockedId },
      });
    });
    await this.redis.del(`blocks:${blockerId}`, `blocks:${blockedId}`);
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const rows = await this.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
      .returning({ id: blocks.blockedId });
    if (rows.length === 0) throw AppError.notFound('Block');
    await this.redis.del(`blocks:${blockerId}`, `blocks:${blockedId}`);
  }

  async blockedByMe(userId: string): Promise<{ id: string; blockedAt: Date }[]> {
    const rows = await this.db
      .select()
      .from(blocks)
      .where(eq(blocks.blockerId, userId))
      .orderBy(desc(blocks.createdAt));
    return rows.map((r) => ({ id: r.blockedId, blockedAt: r.createdAt }));
  }

  // ---------- squad ----------

  async relationshipStatus(viewerId: string, targetId: string): Promise<RelationshipStatus> {
    if (viewerId === targetId) return 'self';
    return relationshipFrom(viewerId, await this.pairRow(viewerId, targetId, this.db));
  }

  /** Graph distance used by visibility policies: squad, friend-of-friend (≥1 mutual), or none. */
  async relationship(viewerId: string, targetId: string): Promise<Relationship> {
    if (viewerId === targetId) return 'self';
    const status = await this.relationshipStatus(viewerId, targetId);
    if (status === 'squad') return 'squad';
    return (await this.mutualFriendIds(viewerId, targetId, 1)).length > 0
      ? 'friend_of_friend'
      : 'none';
  }

  async request(fromId: string, toId: string, now: Date = new Date()): Promise<RelationshipStatus> {
    if (fromId === toId) throw new AppError('VALIDATION_FAILED', 'You cannot add yourself');
    // Blocks look exactly like a missing user: no existence leak.
    if (await this.isBlockedEitherWay(fromId, toId)) throw AppError.notFound('User');
    const [low, high] = orderedPair(fromId, toId);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`friendship:${low}:${high}`}))`);
      const decision = decideRequest(fromId, await this.pairRow(fromId, toId, tx, true), now);
      if (decision.action === 'none') return decision.relationship;
      if (decision.action === 'accept_reverse') {
        await tx
          .update(friendships)
          .set({ status: 'accepted', respondedAt: now })
          .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)));
        await this.outbox.add(tx, {
          aggregateType: 'friendship',
          aggregateId: fromId,
          type: FRIEND_ACCEPTED_EVENT,
          payload: { requesterId: toId, accepterId: fromId },
        });
        return 'squad';
      }
      await tx
        .insert(friendships)
        .values({ userLow: low, userHigh: high, requesterId: fromId, status: 'pending' })
        .onConflictDoUpdate({
          target: [friendships.userLow, friendships.userHigh],
          set: { requesterId: fromId, status: 'pending', respondedAt: null, createdAt: now },
        });
      await this.outbox.add(tx, {
        aggregateType: 'friendship',
        aggregateId: fromId,
        type: FRIEND_REQUESTED_EVENT,
        payload: { requesterId: fromId, recipientId: toId },
      });
      return 'request_sent';
    });
  }

  /** Accept or decline a request someone else sent me. */
  async respond(
    meId: string,
    requesterId: string,
    accept: boolean,
    now: Date = new Date(),
  ): Promise<RelationshipStatus> {
    const [low, high] = orderedPair(meId, requesterId);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(friendships)
        .set({ status: accept ? 'accepted' : 'declined', respondedAt: now })
        .where(
          and(
            eq(friendships.userLow, low),
            eq(friendships.userHigh, high),
            eq(friendships.status, 'pending'),
            eq(friendships.requesterId, requesterId),
          ),
        )
        .returning({ low: friendships.userLow });
      if (rows.length === 0) throw AppError.notFound('Request');
      if (accept) {
        await this.outbox.add(tx, {
          aggregateType: 'friendship',
          aggregateId: meId,
          type: FRIEND_ACCEPTED_EVENT,
          payload: { requesterId, accepterId: meId },
        });
      }
      return accept ? 'squad' : 'none';
    });
  }

  async cancelRequest(meId: string, toId: string): Promise<void> {
    const [low, high] = orderedPair(meId, toId);
    const rows = await this.db
      .update(friendships)
      .set({ status: 'cancelled', respondedAt: new Date() })
      .where(
        and(
          eq(friendships.userLow, low),
          eq(friendships.userHigh, high),
          eq(friendships.status, 'pending'),
          eq(friendships.requesterId, meId),
        ),
      )
      .returning({ low: friendships.userLow });
    if (rows.length === 0) throw AppError.notFound('Request');
  }

  async removeFriend(meId: string, otherId: string): Promise<void> {
    const [low, high] = orderedPair(meId, otherId);
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(friendships)
        .set({ status: 'cancelled', respondedAt: new Date() })
        .where(
          and(
            eq(friendships.userLow, low),
            eq(friendships.userHigh, high),
            eq(friendships.status, 'accepted'),
          ),
        )
        .returning({ low: friendships.userLow });
      if (rows.length === 0) throw AppError.notFound('Squad member');
      await this.outbox.add(tx, {
        aggregateType: 'friendship',
        aggregateId: meId,
        type: FRIEND_REMOVED_EVENT,
        payload: { removedBy: meId, otherId },
      });
    });
  }

  /** Squad members, newest first, keyset-paginated on (since, friendId). */
  async squadPage(
    userId: string,
    after: { t: string; id: string } | null,
    limit: number,
  ): Promise<{ id: string; since: Date }[]> {
    const rows = await this.replica
      .select({ id: squadEdges.friendId, since: squadEdges.since })
      .from(squadEdges)
      .where(
        and(
          eq(squadEdges.userId, userId),
          after
            ? sql`(${squadEdges.since}, ${squadEdges.friendId}) < (${new Date(after.t)}, ${after.id}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(desc(squadEdges.since), desc(squadEdges.friendId))
      .limit(limit);
    return rows;
  }

  async friendIds(userId: string, db: DbOrTx = this.replica): Promise<string[]> {
    const rows = await db
      .select({ id: squadEdges.friendId })
      .from(squadEdges)
      .where(eq(squadEdges.userId, userId));
    return rows.map((r) => r.id);
  }

  async pendingRequests(
    userId: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<{ id: string; createdAt: Date }[]> {
    const rows = await this.db
      .select({
        low: friendships.userLow,
        high: friendships.userHigh,
        requesterId: friendships.requesterId,
        createdAt: friendships.createdAt,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'pending'),
          or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)),
          direction === 'outgoing'
            ? eq(friendships.requesterId, userId)
            : sql`${friendships.requesterId} <> ${userId}`,
        ),
      )
      .orderBy(desc(friendships.createdAt));
    return rows.map((r) => ({ id: r.low === userId ? r.high : r.low, createdAt: r.createdAt }));
  }

  /** Ids of everyone I have any pending request with (either direction). */
  async pendingWith(userId: string): Promise<Set<string>> {
    const [incoming, outgoing] = await Promise.all([
      this.pendingRequests(userId, 'incoming'),
      this.pendingRequests(userId, 'outgoing'),
    ]);
    return new Set([...incoming, ...outgoing].map((r) => r.id));
  }

  async mutualFriendIds(a: string, b: string, limit: number): Promise<string[]> {
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT x.friend_id AS id FROM squad_edges x JOIN squad_edges y ON y.friend_id = x.friend_id
      WHERE x.user_id = ${a} AND y.user_id = ${b}
      ORDER BY x.friend_id LIMIT ${limit}`);
    return res.rows.map((r) => r.id);
  }

  /** Members of `ids` who have nobody else from `ids` in their squad (solo-friendly share, F-EVT-10). */
  async isolatedAmong(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const list = uuidArrayLiteral(ids);
    const res = await this.replica.execute<{ id: string }>(sql`
      SELECT u.id FROM unnest(${list}::uuid[]) AS u(id)
      WHERE NOT EXISTS (
        SELECT 1 FROM squad_edges e WHERE e.user_id = u.id AND e.friend_id = ANY(${list}::uuid[]))`);
    return new Set(res.rows.map((r) => r.id));
  }

  /** Mutual-friend counts between a viewer and many people in one query. */
  async mutualCounts(viewerId: string, others: string[]): Promise<Map<string, number>> {
    if (others.length === 0) return new Map();
    const res = await this.replica.execute<{ id: string; n: number }>(sql`
      SELECT y.user_id AS id, count(*)::int AS n
      FROM squad_edges x JOIN squad_edges y ON y.friend_id = x.friend_id
      WHERE x.user_id = ${viewerId} AND y.user_id = ANY(${uuidArrayLiteral(others)}::uuid[])
      GROUP BY y.user_id`);
    return new Map(res.rows.map((r) => [r.id, r.n]));
  }

  /** Friends of my friends who are not already my squad, with how many mutuals each has (suggestions). */
  async friendsOfFriends(
    userId: string,
    limit: number,
  ): Promise<{ id: string; mutuals: number }[]> {
    const res = await this.replica.execute<{ id: string; mutuals: number }>(sql`
      SELECT y.friend_id AS id, count(*)::int AS mutuals
      FROM squad_edges x JOIN squad_edges y ON y.user_id = x.friend_id
      WHERE x.user_id = ${userId} AND y.friend_id <> ${userId}
        AND NOT EXISTS (SELECT 1 FROM squad_edges z WHERE z.user_id = ${userId} AND z.friend_id = y.friend_id)
      GROUP BY y.friend_id ORDER BY mutuals DESC, y.friend_id LIMIT ${limit}`);
    return res.rows;
  }

  // ---------- contacts & dismissals ----------

  /** Replaces the stored hash set with the latest upload (deleted contacts disappear too). */
  async replaceContactHashes(userId: string, hashes: string[]): Promise<void> {
    const unique = [...new Set(hashes)];
    await this.db.transaction(async (tx) => {
      await tx.delete(contactHashes).where(eq(contactHashes.userId, userId));
      for (let i = 0; i < unique.length; i += 1000) {
        await tx
          .insert(contactHashes)
          .values(unique.slice(i, i + 1000).map((phoneHash) => ({ userId, phoneHash })));
      }
    });
  }

  async myContactHashes(userId: string): Promise<string[]> {
    return (
      await this.replica
        .select({ h: contactHashes.phoneHash })
        .from(contactHashes)
        .where(eq(contactHashes.userId, userId))
    ).map((r) => r.h);
  }

  /** Users who have this phone hash in their address book. */
  async usersWithContact(phoneHash: string): Promise<string[]> {
    return (
      await this.replica
        .select({ id: contactHashes.userId })
        .from(contactHashes)
        .where(eq(contactHashes.phoneHash, phoneHash))
    ).map((r) => r.id);
  }

  async dismiss(userId: string, dismissedUserId: string): Promise<void> {
    await this.db
      .insert(suggestionDismissals)
      .values({ userId, dismissedUserId })
      .onConflictDoNothing();
  }

  async dismissed(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: suggestionDismissals.dismissedUserId })
      .from(suggestionDismissals)
      .where(eq(suggestionDismissals.userId, userId));
    return new Set(rows.map((r) => r.id));
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)));
    return {
      friendships: rows.map((r) => ({
        with: r.userLow === userId ? r.userHigh : r.userLow,
        status: r.status,
        requestedByMe: r.requesterId === userId,
        since: r.createdAt.toISOString(),
      })),
      blocked: (await this.blockedByMe(userId)).map((b) => ({
        id: b.id,
        at: b.blockedAt.toISOString(),
      })),
      contactHashesStored: (await this.myContactHashes(userId)).length,
    };
  }

  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx
      .delete(friendships)
      .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)));
    await tx.delete(blocks).where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
    await tx.delete(contactHashes).where(eq(contactHashes.userId, userId));
    await tx
      .delete(suggestionDismissals)
      .where(
        or(
          eq(suggestionDismissals.userId, userId),
          eq(suggestionDismissals.dismissedUserId, userId),
        ),
      );
    await this.redis.del(`blocks:${userId}`);
  }
}
