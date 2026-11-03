import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { pepperedHash } from '../../../common/auth/hashing.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import { DB, type Database, type Tx } from '../../../infra/database/database.module.js';
import { events, rsvps } from '../../../infra/database/schema/index.js';
import { OutboxService } from '../../../infra/outbox/outbox.service.js';

export const RSVP_GOING_EVENT = 'rsvp.going';

export interface PendingGuestSeat {
  eventId: string;
  inviterUserId: string;
  slug: string;
}

/**
 * Guest +1 seats (F-EVT-07). A member pulling up with a non-member friend holds one extra seat and gets a
 * claim link; the token is stored hashed. Claiming turns that held seat into the new member's own RSVP, so
 * the seat count never changes and no capacity lock is needed (the conditional UPDATE is atomic).
 * Kept dependency-free so the auth module can let a claim link stand in for an invite code.
 */
@Injectable()
export class PlusOneClaimService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly outbox: OutboxService,
  ) {}

  hash(token: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `plus-one:${token}`);
  }

  claimUrl(token: string): string {
    return `${this.env.WEB_PUBLIC_URL}/claim/${token}`;
  }

  /** The open guest seat behind a token, if the event is still ahead and the inviter still going. */
  async pending(token: string, now: Date = new Date()): Promise<PendingGuestSeat | null> {
    const [row] = await this.db
      .select({ eventId: rsvps.eventId, inviterUserId: rsvps.userId, slug: events.slug })
      .from(rsvps)
      .innerJoin(events, eq(events.id, rsvps.eventId))
      .where(
        and(
          eq(rsvps.guestClaimTokenHash, this.hash(token)),
          eq(rsvps.guestSeats, 1),
          inArray(rsvps.status, ['going', 'checked_in']),
          eq(events.status, 'published'),
          gt(events.endsAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Moves the guest seat to `userId`. Fails with NOT_FOUND for unknown/used tokens and CONFLICT if the claimer
   * already has a seat there or is the inviter. Gender bucket starts as 'other' (unverified), matching how the
   * unclaimed guest seat was counted for balanced events.
   */
  async redeem(
    token: string,
    userId: string,
    tx: Tx,
    now: Date = new Date(),
  ): Promise<PendingGuestSeat> {
    const pending = await this.pending(token, now);
    if (!pending) throw AppError.notFound('Claim link');
    if (pending.inviterUserId === userId)
      throw new AppError('CONFLICT', 'That is your own +1 link');
    const [existing] = await tx
      .select({ status: rsvps.status })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, pending.eventId), eq(rsvps.userId, userId)))
      .limit(1);
    if (existing && ['going', 'checked_in', 'waitlisted'].includes(existing.status))
      throw new AppError('CONFLICT', 'You are already on this plan');
    const released = await tx
      .update(rsvps)
      .set({ guestSeats: 0, guestClaimTokenHash: null })
      .where(
        and(
          eq(rsvps.eventId, pending.eventId),
          eq(rsvps.userId, pending.inviterUserId),
          eq(rsvps.guestSeats, 1),
          eq(rsvps.guestClaimTokenHash, this.hash(token)),
          ne(rsvps.status, 'cancelled'),
        ),
      )
      .returning({ eventId: rsvps.eventId });
    if (released.length === 0) throw AppError.notFound('Claim link');
    await tx
      .insert(rsvps)
      .values({
        eventId: pending.eventId,
        userId,
        status: 'going',
        genderBucket: 'other',
        plusOneOf: pending.inviterUserId,
      })
      .onConflictDoUpdate({
        target: [rsvps.eventId, rsvps.userId],
        set: {
          status: 'going',
          genderBucket: 'other',
          plusOneOf: pending.inviterUserId,
          waitlistedAt: null,
          cancelledAt: null,
          lateCancel: false,
          updatedAt: sql`now()`,
        },
      });
    await this.outbox.add(tx, {
      aggregateType: 'event',
      aggregateId: pending.eventId,
      type: RSVP_GOING_EVENT,
      payload: {
        eventId: pending.eventId,
        userId,
        plusOneOf: pending.inviterUserId,
        via: 'guest_claim',
      },
    });
    return pending;
  }
}
