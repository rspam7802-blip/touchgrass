import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { FreeNowList, MyAvailability, SetAvailabilityBody } from '@touchgrass/shared';
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { availabilityStatus } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { PING_PAIR_WINDOW_SECONDS, pingRefusal, pingThrottleKey } from './availability.policy.js';

export const AVAILABILITY_SET_EVENT = 'availability.set';
export const AVAILABILITY_PINGED_EVENT = 'availability.pinged';
const HOUR_MS = 3_600_000;

/** "I'm free now" (F-ENG-01): availability for the next 1–6 hours, seen by the squad, expiring on its own. */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async mine(userId: string, now: Date = new Date()): Promise<MyAvailability> {
    const [row] = await this.db
      .select()
      .from(availabilityStatus)
      .where(and(eq(availabilityStatus.userId, userId), gt(availabilityStatus.until, now)));
    return row ? { until: row.until.toISOString(), note: row.note } : { until: null, note: '' };
  }

  /**
   * Sets (or extends) availability. The squad is notified only when someone becomes free, not each time
   * they edit their note or hours, so a busy toggler can't spam their friends.
   */
  async set(
    userId: string,
    body: SetAvailabilityBody,
    now: Date = new Date(),
  ): Promise<MyAvailability> {
    const until = new Date(now.getTime() + body.hours * HOUR_MS);
    await this.db.transaction(async (tx) => {
      const [prev] = await tx
        .select()
        .from(availabilityStatus)
        .where(eq(availabilityStatus.userId, userId))
        .for('update');
      const fresh = !prev || prev.until <= now;
      await tx
        .insert(availabilityStatus)
        .values({ userId, until, note: body.note })
        .onConflictDoUpdate({ target: availabilityStatus.userId, set: { until, note: body.note } });
      if (fresh)
        await this.outbox.add(tx, {
          aggregateType: 'user',
          aggregateId: userId,
          type: AVAILABILITY_SET_EVENT,
          payload: { userId, until: until.toISOString(), note: body.note },
        });
    });
    return { until: until.toISOString(), note: body.note };
  }

  async clear(userId: string): Promise<void> {
    await this.db.delete(availabilityStatus).where(eq(availabilityStatus.userId, userId));
  }

  /** Squad members free right now, soonest-ending last so the freshest show first. */
  async squadFree(userId: string, now: Date = new Date()): Promise<FreeNowList> {
    const friends = await this.graph.friendIds(userId);
    const rows =
      friends.length === 0
        ? []
        : await this.db
            .select()
            .from(availabilityStatus)
            .where(
              and(inArray(availabilityStatus.userId, friends), gt(availabilityStatus.until, now)),
            );
    const cards = await this.people.cards(
      userId,
      rows.map((r) => r.userId),
    );
    const items = rows
      .filter((r) => cards.has(r.userId))
      .sort((a, b) => b.until.getTime() - a.until.getTime())
      .flatMap((r) => {
        const person = cards.get(r.userId);
        return person ? [{ person, until: r.until.toISOString(), note: r.note }] : [];
      });
    return { me: await this.mine(userId, now), items };
  }

  /**
   * Ping a squad member who is free now ("want to meet up?"). The notification goes out through the outbox, so
   * quiet hours and notification settings apply. One ping per pair per 30 minutes.
   */
  async ping(fromId: string, toId: string, now: Date = new Date()): Promise<void> {
    const [relationship, blockedEitherWay, row] = await Promise.all([
      this.graph.relationshipStatus(fromId, toId),
      this.graph.isBlockedEitherWay(fromId, toId),
      this.db
        .select({ until: availabilityStatus.until })
        .from(availabilityStatus)
        .where(eq(availabilityStatus.userId, toId))
        .then((r) => r[0]),
    ]);
    const refusal = pingRefusal({
      fromId,
      toId,
      inSquad: relationship === 'squad',
      blockedEitherWay,
      targetFreeUntil: row?.until ?? null,
      now,
    });
    if (refusal === 'self') throw new AppError('VALIDATION_FAILED', 'You cannot ping yourself');
    if (refusal === 'not_found') throw AppError.notFound('User');
    if (refusal === 'not_free') throw new AppError('NOT_FREE_NOW', 'They are not free any more');
    const claimed = await this.redis.set(
      pingThrottleKey(fromId, toId),
      '1',
      'EX',
      PING_PAIR_WINDOW_SECONDS,
      'NX',
    );
    if (claimed === null) {
      const ttl = await this.redis.ttl(pingThrottleKey(fromId, toId));
      throw new AppError('RATE_LIMITED', 'You pinged them recently', {
        retryAfterSeconds: Math.max(ttl, 1),
      });
    }
    await this.db.transaction(async (tx) => {
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: toId,
        type: AVAILABILITY_PINGED_EVENT,
        payload: { fromId, toId },
      });
    });
  }

  /** Who should hear that `userId` is free: their squad, minus anyone blocked either way. */
  async audience(userId: string): Promise<string[]> {
    const [friends, blocked] = await Promise.all([
      this.graph.friendIds(userId),
      this.graph.blockedSet(userId),
    ]);
    return friends.filter((id) => !blocked.has(id));
  }

  /** Hourly: drop expired rows (reads already ignore them). */
  async sweep(now: Date = new Date()): Promise<number> {
    const gone = await this.db
      .delete(availabilityStatus)
      .where(lte(availabilityStatus.until, now))
      .returning({ userId: availabilityStatus.userId });
    return gone.length;
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [row] = await this.db
      .select()
      .from(availabilityStatus)
      .where(eq(availabilityStatus.userId, userId));
    return {
      availability: row ? { until: row.until.toISOString(), note: row.note } : null,
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(availabilityStatus).where(eq(availabilityStatus.userId, userId));
  }
}
