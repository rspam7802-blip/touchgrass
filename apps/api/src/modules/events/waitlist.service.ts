import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { events, rsvps, waitlistOffers } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { withRedisLock } from '../../infra/redis/redis-lock.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { balancedAllows, waitlistMode } from './event.policy.js';
import { type EventCore, EventStore } from './event-store.service.js';

export const WAITLIST_OFFERED_EVENT = 'waitlist.offered';

export const eventLockKey = (eventId: string): string => `event:${eventId}`;

export interface OpenOffer {
  userId: string;
  mode: 'sequential' | 'broadcast';
  expiresAt: Date;
}

/**
 * Waitlist and last-minute spots (F-EVT-08). A freed seat becomes an offer: far from the start the next person
 * in line gets it exclusively for N minutes (sequential); within 6 h everyone waiting is told at once and the
 * first to claim wins (broadcast). Sequential offers reserve their seat; broadcast offers do not.
 * Every mutation runs under the event's Redis lock and a row lock on the event (see RsvpService).
 */
@Injectable()
export class WaitlistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: EventStore,
    private readonly settings: AppSettingsService,
    private readonly outbox: OutboxService,
  ) {}

  async openOffers(tx: Tx, eventId: string, now: Date): Promise<OpenOffer[]> {
    return tx
      .select({
        userId: waitlistOffers.userId,
        mode: waitlistOffers.mode,
        expiresAt: waitlistOffers.expiresAt,
      })
      .from(waitlistOffers)
      .where(
        and(
          eq(waitlistOffers.eventId, eventId),
          eq(waitlistOffers.status, 'open'),
          gt(waitlistOffers.expiresAt, now),
        ),
      );
  }

  /** Seats a newcomer (without an offer) may take right now: free seats minus reserved offers; zero while anyone waits. */
  async freeForNewcomer(
    tx: Tx,
    core: EventCore,
    seats: number,
    waitlisted: number,
    now: Date,
  ): Promise<number> {
    if (waitlisted > 0) return 0;
    const reserved = (await this.openOffers(tx, core.id, now)).filter(
      (o) => o.mode === 'sequential',
    ).length;
    return Math.max(0, core.capacity - seats - reserved);
  }

  /** Seats someone holding an offer may take: sequential offers own their seat; broadcast competes for what is free. */
  async freeForOfferHolder(
    tx: Tx,
    core: EventCore,
    seats: number,
    userId: string,
    now: Date,
  ): Promise<number> {
    const others = (await this.openOffers(tx, core.id, now)).filter(
      (o) => o.mode === 'sequential' && o.userId !== userId,
    ).length;
    return Math.max(0, core.capacity - seats - others);
  }

  /** Marks the viewer's offer claimed and, once the event is full again, withdraws the remaining broadcast offers. */
  async afterClaim(tx: Tx, core: EventCore, userId: string): Promise<void> {
    await tx
      .update(waitlistOffers)
      .set({ status: 'claimed' })
      .where(
        and(
          eq(waitlistOffers.eventId, core.id),
          eq(waitlistOffers.userId, userId),
          eq(waitlistOffers.status, 'open'),
        ),
      );
    const { seats } = await this.store.seatCounts(core.id, tx);
    if (seats >= core.capacity) {
      await tx
        .update(waitlistOffers)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(waitlistOffers.eventId, core.id),
            eq(waitlistOffers.status, 'open'),
            eq(waitlistOffers.mode, 'broadcast'),
          ),
        );
    }
  }

  /** Withdraws every open offer (event cancelled, or the person left the waitlist). */
  async withdraw(tx: Tx, eventId: string, userId?: string): Promise<void> {
    await tx
      .update(waitlistOffers)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(waitlistOffers.eventId, eventId),
          eq(waitlistOffers.status, 'open'),
          userId ? eq(waitlistOffers.userId, userId) : undefined,
        ),
      );
  }

  /**
   * Turns free seats into offers. Call inside the event lock with the event row locked. Returns offers issued.
   * Balanced events skip people whose gender bucket is already at its cap.
   */
  async promote(tx: Tx, core: EventCore, now: Date): Promise<number> {
    if (core.status !== 'published' || now.getTime() >= core.endsAt.getTime()) return 0;
    const counts = await this.store.seatCounts(core.id, tx);
    if (counts.waitlisted === 0) return 0;
    const open = await this.openOffers(tx, core.id, now);
    const free = core.capacity - counts.seats - open.filter((o) => o.mode === 'sequential').length;
    if (free <= 0) return 0;
    const offered = new Set(open.map((o) => o.userId));
    const queue = await tx
      .select({ userId: rsvps.userId, bucket: rsvps.genderBucket })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, core.id), eq(rsvps.status, 'waitlisted')))
      .orderBy(asc(rsvps.waitlistedAt), asc(rsvps.userId));
    const candidates = queue.filter(
      (q) => !offered.has(q.userId) && balancedAllows(core, counts.byBucket[q.bucket], 1),
    );
    const mode = waitlistMode(core, now);
    const chosen = mode === 'sequential' ? candidates.slice(0, free) : candidates;
    if (chosen.length === 0) return 0;
    const minutes = await this.settings.get('waitlist_claim_minutes', tx);
    const expiresAt =
      mode === 'sequential'
        ? new Date(Math.min(now.getTime() + minutes * 60_000, core.endsAt.getTime()))
        : core.endsAt;
    await tx.insert(waitlistOffers).values(
      chosen.map((c) => ({
        id: uuidv7(),
        eventId: core.id,
        userId: c.userId,
        mode,
        status: 'open' as const,
        expiresAt,
      })),
    );
    for (const c of chosen) {
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: core.id,
        type: WAITLIST_OFFERED_EVENT,
        payload: { eventId: core.id, userId: c.userId, mode, expiresAt: expiresAt.toISOString() },
      });
    }
    return chosen.length;
  }

  /** Runs `promote` for one event under its locks. */
  async promoteEvent(eventId: string, now: Date = new Date()): Promise<number> {
    return withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const core = await this.store.core(eventId, tx, { lock: true });
        return core ? this.promote(tx, core, now) : 0;
      }),
    );
  }

  /**
   * Every minute: expire lapsed offers (a lapsed sequential offer sends that person to the back of the line),
   * then offer free seats on every upcoming event with a waitlist — which also switches events entering their
   * last 6 h to broadcast.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    const expired = await this.db
      .update(waitlistOffers)
      .set({ status: 'expired' })
      .where(and(eq(waitlistOffers.status, 'open'), lte(waitlistOffers.expiresAt, now)))
      .returning({
        eventId: waitlistOffers.eventId,
        userId: waitlistOffers.userId,
        mode: waitlistOffers.mode,
      });
    for (const e of expired.filter((x) => x.mode === 'sequential')) {
      await this.db
        .update(rsvps)
        .set({ waitlistedAt: now })
        .where(
          and(
            eq(rsvps.eventId, e.eventId),
            eq(rsvps.userId, e.userId),
            eq(rsvps.status, 'waitlisted'),
          ),
        );
    }
    const candidates = await this.db
      .selectDistinct({ id: events.id })
      .from(events)
      .innerJoin(rsvps, and(eq(rsvps.eventId, events.id), eq(rsvps.status, 'waitlisted')))
      .where(and(eq(events.status, 'published'), gt(events.endsAt, now)));
    let issued = 0;
    for (const c of candidates) issued += await this.promoteEvent(c.id, now);
    return expired.length + issued;
  }

  /** Waitlist position (1-based) for a person, or null. */
  async position(eventId: string, userId: string): Promise<number | null> {
    const res = await this.db.execute<{ pos: number }>(sql`
      SELECT pos FROM (
        SELECT user_id, row_number() OVER (ORDER BY waitlisted_at, user_id)::int AS pos
        FROM rsvps WHERE event_id = ${eventId} AND status = 'waitlisted') q
      WHERE user_id = ${userId}`);
    return res.rows[0]?.pos ?? null;
  }

  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx.delete(waitlistOffers).where(eq(waitlistOffers.userId, userId));
  }
}
