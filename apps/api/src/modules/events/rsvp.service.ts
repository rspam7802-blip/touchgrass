import { Inject, Injectable } from '@nestjs/common';
import type {
  AttendeeList,
  ClaimPlusOneResult,
  PlusOnePreview,
  ReliabilityTier,
  RsvpBody,
  RsvpResult,
} from '@touchgrass/shared';
import { genderOnly, isPopularPlan } from '@touchgrass/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { randomToken } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { rsvps } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { withRedisLock } from '../../infra/redis/redis-lock.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  EventAccessService,
  type EventViewerFacts,
  type ViewerContext,
} from './event-access.service.js';
import {
  balancedAllows,
  canViewEvent,
  genderBucket,
  genderOnlyError,
  holdsSeat,
  type IneligibleReason,
  isLateCancel,
  isLetIn,
  matchesGenderOnly,
  rsvpEligibility,
} from './event.policy.js';
import { type EventCore, EventStore } from './event-store.service.js';
import { EventViewService } from './event-view.service.js';
import { PlusOneClaimService, RSVP_GOING_EVENT } from './plus-one/plus-one-claim.service.js';
import { eventLockKey, WaitlistService } from './waitlist.service.js';
import { ReliabilityReader } from '../reliability/reliability-reader.js';

export const RSVP_WAITLISTED_EVENT = 'rsvp.waitlisted';
export const RSVP_CANCELLED_EVENT = 'rsvp.cancelled';

const REASON_ERRORS: Record<IneligibleReason, AppError> = {
  CLOSED: new AppError('EVENT_CLOSED', 'This plan is not taking RSVPs'),
  BLOCKED: AppError.notFound('Event'),
  NOT_INVITED: AppError.notFound('Event'),
  WOMEN_ONLY: new AppError('NOT_ELIGIBLE', 'This plan is for verified women', {
    reason: 'WOMEN_ONLY',
  }),
  MEN_ONLY: new AppError('NOT_ELIGIBLE', 'This plan is for verified men', {
    reason: 'MEN_ONLY',
  }),
  VERIFICATION_REQUIRED: new AppError(
    'VERIFICATION_REQUIRED',
    'Get verified to pull up to this plan',
  ),
  APPROVAL_REQUIRED: new AppError('NOT_ELIGIBLE', 'Ask the host to join this plan', {
    reason: 'APPROVAL_REQUIRED',
  }),
  HOST: new AppError('CONFLICT', 'You are hosting this plan'),
};

type Outcome = {
  status: 'going' | 'waitlisted' | 'interested' | 'held';
  guestToken: string | null;
};

const PAYMENT_REQUIRED = new AppError('NOT_ELIGIBLE', 'This is a paid plan: pay to pull up', {
  reason: 'PAYMENT_REQUIRED',
});

/** Runs inside the seat transaction, so a payment row and the seat it pays for commit together. */
export type InSeatTx = (tx: Tx, locked: EventCore) => Promise<void>;

/**
 * Pull up and capacity (F-EVT-06), +1s (F-EVT-07), waitlist claims (F-EVT-08), balanced ratios.
 * Seat-changing writes take the event's Redis lock AND lock the event row, then count seats inside the
 * transaction, so concurrent pull-ups for the last spot can never double-book.
 */
@Injectable()
export class RsvpService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly view: EventViewService,
    private readonly waitlist: WaitlistService,
    private readonly outbox: OutboxService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly plusOnes: PlusOneClaimService,
    private readonly reliability: ReliabilityReader,
  ) {}

  async rsvp(
    userId: string,
    eventId: string,
    body: RsvpBody,
    now: Date = new Date(),
  ): Promise<RsvpResult> {
    const { core, ctx, facts } = await this.access.visibleOrThrow(userId, eventId);
    const eligibility = rsvpEligibility(facts, core, now);
    if (!eligibility.ok) throw REASON_ERRORS[eligibility.reason];
    let outcome: Outcome;
    if (body.status === 'going' && core.pricePaise > 0) throw PAYMENT_REQUIRED;
    if (body.status === 'interested') {
      outcome = await this.markInterested(ctx, core, now);
    } else {
      if (body.plusOne && !core.allowPlusOnes)
        throw new AppError('NOT_ELIGIBLE', 'This plan has no +1s', { reason: 'NO_PLUS_ONES' });
      const member =
        body.plusOne && 'userId' in body.plusOne
          ? await this.memberPlusOne(ctx, core, body.plusOne.userId)
          : null;
      if (body.plusOne && 'guest' in body.plusOne && genderOnly(core.visibility) !== null)
        throw genderOnlyError(
          core.visibility,
          'Guest +1s cannot join women-only or men-only plans',
        );
      outcome = await this.going(
        ctx,
        core,
        {
          member,
          guest: body.plusOne !== null && 'guest' in body.plusOne,
          requireOffer: false,
          hold: null,
        },
        now,
      );
    }
    return {
      status: outcome.status,
      plusOneClaimUrl: outcome.guestToken ? this.plusOnes.claimUrl(outcome.guestToken) : null,
      event: await this.detail(ctx, eventId),
    };
  }

  /** Claim an open waitlist offer (F-EVT-08). */
  async claimOffer(userId: string, eventId: string, now: Date = new Date()): Promise<RsvpResult> {
    const { core, ctx, facts } = await this.access.visibleOrThrow(userId, eventId);
    const eligibility = rsvpEligibility(facts, core, now);
    if (!eligibility.ok) throw REASON_ERRORS[eligibility.reason];
    if (core.pricePaise > 0) throw PAYMENT_REQUIRED;
    const outcome = await this.going(
      ctx,
      core,
      { member: null, guest: false, requireOffer: true, hold: null },
      now,
    );
    return {
      status: outcome.status,
      plusOneClaimUrl: null,
      event: await this.detail(ctx, eventId),
    };
  }

  /** Fresh detail after a change; the viewer context (gender, blocks, squad) cannot have changed, so reuse it. */
  private async detail(ctx: ViewerContext, eventId: string) {
    // RSVPs never change the cached core (counts are read live), so the cache stays valid.
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    const facts = await this.access.facts(ctx, eventId);
    if (!canViewEvent(facts, core)) throw AppError.notFound('Event');
    return this.view.detail(ctx, core, facts);
  }

  private async markInterested(ctx: ViewerContext, core: EventCore, now: Date): Promise<Outcome> {
    const [row] = await this.db
      .select({ status: rsvps.status })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, ctx.userId)))
      .limit(1);
    if (row && (holdsSeat(row.status) || row.status === 'waitlisted'))
      await this.cancel(ctx.userId, core.id, now);
    await this.db
      .insert(rsvps)
      .values({
        eventId: core.id,
        userId: ctx.userId,
        status: 'interested',
        genderBucket: genderBucket(ctx.gender, ctx.verified),
      })
      .onConflictDoUpdate({
        target: [rsvps.eventId, rsvps.userId],
        set: { status: 'interested', plusOneOf: null, waitlistedAt: null, updatedAt: sql`now()` },
      });
    return { status: 'interested', guestToken: null };
  }

  /** A member +1 must be in my squad, able to see the plan, and not already on it. */
  private async memberPlusOne(
    ctx: ViewerContext,
    core: EventCore,
    friendId: string,
  ): Promise<{ ctx: ViewerContext; facts: EventViewerFacts }> {
    if (!ctx.squad.has(friendId))
      throw new AppError('NOT_ELIGIBLE', 'Your +1 must be in your squad', { reason: 'NOT_SQUAD' });
    const fctx = await this.access.context(friendId);
    const ffacts = await this.access.facts(fctx, core.id);
    // Being brought along counts as an invite for visibility, but blocks and women-only still apply.
    const asInvited = { ...ffacts, invited: true };
    if (!canViewEvent(asInvited, core) || ffacts.hostRole)
      throw new AppError('NOT_ELIGIBLE', 'They cannot join this plan', {
        reason: 'PLUS_ONE_INELIGIBLE',
      });
    if (holdsSeat(ffacts.rsvp) || ffacts.rsvp === 'waitlisted')
      throw new AppError('CONFLICT', 'They are already on this plan');
    return { ctx: fctx, facts: ffacts };
  }

  private async going(
    ctx: ViewerContext,
    core: EventCore,
    opts: {
      member: { ctx: ViewerContext } | null;
      guest: boolean;
      requireOffer: boolean;
      /** Paid plans: reserve the seat as `held` and record the checkout in the same transaction. */
      hold: InSeatTx | null;
    },
    now: Date,
  ): Promise<Outcome> {
    const cooldown = await this.reliability.cooldownUntil(ctx.userId, now);
    return withRedisLock(this.redis, eventLockKey(core.id), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(core.id, tx, { lock: true });
        if (!locked || locked.status !== 'published' || now.getTime() >= locked.endsAt.getTime())
          throw new AppError('EVENT_CLOSED', 'This plan is not taking RSVPs');
        const [mine] = await tx
          .select({ status: rsvps.status, guestSeats: rsvps.guestSeats })
          .from(rsvps)
          .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, ctx.userId)))
          .limit(1);
        const wantsExtra = opts.member !== null || opts.guest;
        if (opts.hold && mine?.status === 'held') {
          await opts.hold(tx, locked);
          return { status: 'held', guestToken: null };
        }
        if (mine && holdsSeat(mine.status)) {
          if (opts.hold)
            throw new AppError('CONFLICT', "You're already going", { reason: 'ALREADY_IN' });
          if (wantsExtra)
            throw new AppError('CONFLICT', 'Cancel and pull up again to change your +1');
          return { status: 'going', guestToken: null };
        }
        if (mine?.status === 'waitlisted' && wantsExtra)
          throw new AppError('CONFLICT', 'You are on the waitlist without a +1');
        const offers = await this.waitlist.openOffers(tx, core.id, now);
        const hasOffer = offers.some((o) => o.userId === ctx.userId);
        if (opts.requireOffer && !hasOffer)
          throw new AppError('OFFER_EXPIRED', 'That spot is gone');
        const counts = await this.store.seatCounts(core.id, tx);
        // Repeat no-shows sit out popular plans for a while (F-SAF-02); a waitlist offer still counts.
        if (
          cooldown &&
          !hasOffer &&
          mine?.status !== 'held' &&
          isPopularPlan(locked.capacity, counts.seats, counts.waitlisted)
        )
          throw new AppError('NOT_ELIGIBLE', 'Popular plans open to you again soon', {
            reason: 'RELIABILITY_COOLDOWN',
            until: cooldown.toISOString(),
          });
        const needed = 1 + (wantsExtra ? 1 : 0);
        const free = hasOffer
          ? await this.waitlist.freeForOfferHolder(tx, locked, counts.seats, ctx.userId, now)
          : await this.waitlist.freeForNewcomer(
              tx,
              locked,
              counts.seats,
              counts.waitlisted - (mine?.status === 'waitlisted' ? 1 : 0),
              now,
            );
        const bucket = genderBucket(ctx.gender, ctx.verified);
        const friendBucket = opts.member
          ? genderBucket(opts.member.ctx.gender, opts.member.ctx.verified)
          : opts.guest
            ? 'other'
            : null;
        const bucketAdds: Record<'woman' | 'man' | 'other', number> = {
          woman: 0,
          man: 0,
          other: 0,
        };
        bucketAdds[bucket] += 1;
        if (friendBucket) bucketAdds[friendBucket] += 1;
        const ratioOk = (['woman', 'man', 'other'] as const).every(
          (b) => bucketAdds[b] === 0 || balancedAllows(locked, counts.byBucket[b], bucketAdds[b]),
        );

        if (free >= needed && ratioOk && opts.hold) {
          await this.upsertSeat(tx, core.id, ctx.userId, bucket, null, null, 'held');
          if (hasOffer) await this.waitlist.afterClaim(tx, locked, ctx.userId);
          await opts.hold(tx, locked);
          return { status: 'held', guestToken: null };
        }
        if (free >= needed && ratioOk) {
          const guestToken = opts.guest ? randomToken() : null;
          await this.upsertSeat(
            tx,
            core.id,
            ctx.userId,
            bucket,
            null,
            guestToken ? this.plusOnes.hash(guestToken) : null,
          );
          if (opts.member)
            await this.upsertSeat(
              tx,
              core.id,
              opts.member.ctx.userId,
              genderBucket(opts.member.ctx.gender, opts.member.ctx.verified),
              ctx.userId,
              null,
            );
          if (hasOffer) await this.waitlist.afterClaim(tx, locked, ctx.userId);
          await this.outbox.add(tx, {
            aggregateType: 'event',
            aggregateId: core.id,
            type: RSVP_GOING_EVENT,
            payload: {
              eventId: core.id,
              userId: ctx.userId,
              plusOneUserId: opts.member?.ctx.userId ?? null,
              guest: opts.guest,
              via: hasOffer ? 'waitlist' : 'direct',
            },
          });
          if (opts.member) {
            await this.outbox.add(tx, {
              aggregateType: 'event',
              aggregateId: core.id,
              type: RSVP_GOING_EVENT,
              payload: {
                eventId: core.id,
                userId: opts.member.ctx.userId,
                plusOneOf: ctx.userId,
                via: 'plus_one',
              },
            });
          }
          return { status: 'going', guestToken };
        }
        if (hasOffer) throw new AppError('OFFER_EXPIRED', 'Someone else grabbed that spot');
        if (wantsExtra)
          throw new AppError('EVENT_FULL', 'Not enough spots for you and a +1', {
            spotsLeft: free,
          });
        if (mine?.status === 'waitlisted') return { status: 'waitlisted', guestToken: null };
        await tx
          .insert(rsvps)
          .values({
            eventId: core.id,
            userId: ctx.userId,
            status: 'waitlisted',
            genderBucket: bucket,
            waitlistedAt: now,
          })
          .onConflictDoUpdate({
            target: [rsvps.eventId, rsvps.userId],
            set: {
              status: 'waitlisted',
              genderBucket: bucket,
              waitlistedAt: now,
              plusOneOf: null,
              guestSeats: 0,
              guestClaimTokenHash: null,
              cancelledAt: null,
              lateCancel: false,
              updatedAt: sql`now()`,
            },
          });
        await this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: core.id,
          type: RSVP_WAITLISTED_EVENT,
          payload: { eventId: core.id, userId: ctx.userId },
        });
        // A seat may be free but reserved for people already waiting: offer it to them now.
        await this.waitlist.promote(tx, locked, now);
        return { status: 'waitlisted', guestToken: null };
      }),
    );
  }

  private async upsertSeat(
    tx: Tx,
    eventId: string,
    userId: string,
    bucket: 'woman' | 'man' | 'other',
    plusOneOf: string | null,
    guestTokenHash: string | null,
    status: 'going' | 'held' = 'going',
  ): Promise<void> {
    const values = {
      status,
      genderBucket: bucket,
      plusOneOf,
      guestSeats: guestTokenHash ? 1 : 0,
      guestClaimTokenHash: guestTokenHash,
      waitlistedAt: null,
      cancelledAt: null,
      lateCancel: false,
    };
    await tx
      .insert(rsvps)
      .values({ eventId, userId, ...values })
      .onConflictDoUpdate({
        target: [rsvps.eventId, rsvps.userId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }

  /**
   * Drop out (or leave the waitlist / interested list). Seats freed go to the waitlist. Within 3 h of the start
   * it counts as a late cancel (F-SAF-02). A member +1 keeps their own seat; an unclaimed guest seat is released.
   */
  async cancel(userId: string, eventId: string, now: Date = new Date()): Promise<void> {
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    const hosts = await this.store.hosts(eventId);
    if (hosts.some((h) => h.userId === userId && h.role === 'host'))
      throw new AppError('CONFLICT', 'Hosts cancel the plan instead');
    await withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(eventId, tx, { lock: true });
        if (!locked) throw AppError.notFound('Event');
        const [mine] = await tx
          .select({ status: rsvps.status })
          .from(rsvps)
          .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId)))
          .limit(1);
        if (!mine || mine.status === 'cancelled') return;
        if (mine.status === 'checked_in') throw new AppError('CONFLICT', 'You already checked in');
        const hadSeat = holdsSeat(mine.status);
        const wasHeld = mine.status === 'held';
        const late = hadSeat && locked.status === 'published' && isLateCancel(locked, now);
        await tx
          .update(rsvps)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            lateCancel: late,
            guestSeats: 0,
            guestClaimTokenHash: null,
            waitlistedAt: null,
          })
          .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId)));
        // Co-hosts and welcome hosts who drop out stop hosting.
        await this.removeHostRole(tx, eventId, userId);
        await this.waitlist.withdraw(tx, eventId, userId);
        if (hadSeat || wasHeld || mine.status === 'waitlisted') {
          await this.outbox.add(tx, {
            aggregateType: 'event',
            aggregateId: eventId,
            type: RSVP_CANCELLED_EVENT,
            payload: { eventId, userId, late, hadSeat, wasHeld, cancelledAt: now.toISOString() },
          });
        }
        if (hadSeat || wasHeld) await this.waitlist.promote(tx, locked, now);
      }),
    );
  }

  /**
   * Priority pass (F-GRW-01): moves a waitlisted person to the front of the line. `spend` consumes the pass in
   * the same transaction, so a pass is never used without the move (or moved without a pass).
   */
  async jumpWaitlist(
    userId: string,
    eventId: string,
    spend: (tx: Tx) => Promise<void>,
  ): Promise<number> {
    await withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(eventId, tx, { lock: true });
        if (!locked) throw AppError.notFound('Event');
        const [mine] = await tx
          .select({ status: rsvps.status })
          .from(rsvps)
          .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId)))
          .limit(1);
        if (mine?.status !== 'waitlisted' || locked.status !== 'published')
          throw new AppError('NOT_ELIGIBLE', 'Not on the waitlist', { reason: 'NOT_WAITLISTED' });
        await spend(tx);
        await tx.execute(sql`
          UPDATE rsvps SET waitlisted_at = (
            SELECT min(waitlisted_at) - interval '1 millisecond' FROM rsvps
            WHERE event_id = ${eventId} AND status = 'waitlisted')
          WHERE event_id = ${eventId} AND user_id = ${userId}`);
      }),
    );
    return (await this.waitlist.position(eventId, userId)) ?? 1;
  }

  // ---------- paid plans (F-PAY-01): hold → confirm on verified payment, or release ----------

  /**
   * Checkout step one: everything a free pull-up checks, then the seat is reserved as `held` and `record` writes
   * the payment in the same transaction. A full plan puts the person on the waitlist instead (they pay when a
   * spot is offered).
   */
  async holdForCheckout(
    userId: string,
    eventId: string,
    opts: { fromOffer: boolean },
    record: InSeatTx,
    now: Date = new Date(),
  ): Promise<'held' | 'waitlisted'> {
    const { core, ctx, facts } = await this.access.visibleOrThrow(userId, eventId);
    const eligibility = rsvpEligibility(facts, core, now);
    if (!eligibility.ok) throw REASON_ERRORS[eligibility.reason];
    if (core.pricePaise === 0)
      throw new AppError('CONFLICT', 'This plan is free: just pull up', { reason: 'FREE' });
    const outcome = await this.going(
      ctx,
      core,
      { member: null, guest: false, requireOffer: opts.fromOffer, hold: record },
      now,
    );
    return outcome.status === 'held' ? 'held' : 'waitlisted';
  }

  /**
   * A verified payment arrived. A held seat becomes `going`. If the hold had already lapsed, the person still
   * gets in when a seat is free; otherwise `onSettled` hears `false` and the payment is refunded. Idempotent.
   */
  async confirmPaid(
    eventId: string,
    userId: string,
    onSettled: (tx: Tx, seated: boolean, alreadySeated: boolean) => Promise<void>,
    now: Date = new Date(),
  ): Promise<boolean> {
    return withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(eventId, tx, { lock: true });
        if (!locked) throw AppError.notFound('Event');
        const [mine] = await tx
          .select({ status: rsvps.status, bucket: rsvps.genderBucket })
          .from(rsvps)
          .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId)))
          .limit(1);
        const alreadySeated = mine !== undefined && holdsSeat(mine.status);
        let seated = alreadySeated;
        if (!seated && mine?.status === 'held') {
          seated = true;
        } else if (!seated && locked.status === 'published' && now < locked.endsAt) {
          const counts = await this.store.seatCounts(eventId, tx);
          const waiting = counts.waitlisted - (mine?.status === 'waitlisted' ? 1 : 0);
          const free = await this.waitlist.freeForNewcomer(tx, locked, counts.seats, waiting, now);
          const bucket = mine?.bucket ?? 'other';
          seated = free >= 1 && balancedAllows(locked, counts.byBucket[bucket], 1);
        }
        if (seated && mine?.status !== 'going' && mine?.status !== 'checked_in') {
          await this.upsertSeat(tx, eventId, userId, mine?.bucket ?? 'other', null, null);
          await this.outbox.add(tx, {
            aggregateType: 'event',
            aggregateId: eventId,
            type: RSVP_GOING_EVENT,
            payload: { eventId, userId, plusOneUserId: null, guest: false, via: 'paid' },
          });
        }
        await onSettled(tx, seated, alreadySeated);
        return seated;
      }),
    );
  }

  /** Checkout abandoned, failed or timed out: the held seat goes back (and to the waitlist). Idempotent. */
  async releaseHold(
    eventId: string,
    userId: string,
    onReleased: (tx: Tx) => Promise<void>,
    now: Date = new Date(),
  ): Promise<void> {
    await withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(eventId, tx, { lock: true });
        const released = await tx
          .update(rsvps)
          .set({ status: 'cancelled', cancelledAt: now, lateCancel: false })
          .where(
            and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId), eq(rsvps.status, 'held')),
          )
          .returning({ userId: rsvps.userId });
        await onReleased(tx);
        if (released.length > 0 && locked) await this.waitlist.promote(tx, locked, now);
      }),
    );
  }

  private async removeHostRole(tx: Tx, eventId: string, userId: string): Promise<void> {
    await tx.execute(
      sql`DELETE FROM event_hosts WHERE event_id = ${eventId} AND user_id = ${userId} AND role <> 'host'`,
    );
  }

  // ---------- guest +1 claims ----------

  async plusOnePreview(token: string): Promise<PlusOnePreview> {
    const pending = await this.plusOnes.pending(token);
    if (!pending) throw AppError.notFound('Claim link');
    const core = await this.store.core(pending.eventId);
    if (!core) throw AppError.notFound('Claim link');
    const inviterName =
      (await this.profiles.displayNames([pending.inviterUserId])).get(pending.inviterUserId) ??
      'Your friend';
    // The friend is effectively invited, so they see the basics even for non-public plans — but never the spot.
    const event = await this.view.publicView({ ...core, visibility: 'public' });
    return { inviterName, event };
  }

  /** A signed-in member claims a friend's guest +1 link. */
  async claimPlusOne(userId: string, token: string): Promise<ClaimPlusOneResult> {
    const pending = await this.plusOnes.pending(token);
    if (!pending) throw AppError.notFound('Claim link');
    const core = await this.store.core(pending.eventId);
    if (!core) throw AppError.notFound('Claim link');
    const ctx = await this.access.context(userId);
    const facts = await this.access.facts(ctx, core.id);
    if (facts.blockedWithHost || ctx.blocked.has(pending.inviterUserId))
      throw AppError.notFound('Claim link');
    if (!matchesGenderOnly(core.visibility, ctx))
      throw REASON_ERRORS[genderOnly(core.visibility) === 'man' ? 'MEN_ONLY' : 'WOMEN_ONLY'];
    await this.db.transaction(async (tx) => {
      await this.plusOnes.redeem(token, userId, tx);
      // Their verified gender (if any) now replaces the guest's 'other' bucket for balanced events.
      await tx
        .update(rsvps)
        .set({ genderBucket: genderBucket(ctx.gender, ctx.verified) })
        .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, userId)));
    });
    await this.store.invalidate(core.id);
    return { eventId: core.id, slug: core.slug };
  }

  // ---------- who's going (F-EVT-06, F-EVT-13 newcomer list) ----------

  /**
   * People going. Hidden: blocked people, and anyone who turned off "show me in who's going" (hosts still
   * see everyone, since they run the door). First-timers are flagged when they allow the badge.
   */
  async attendees(viewerId: string, eventId: string): Promise<AttendeeList> {
    const { core, facts } = await this.access.visibleOrThrow(viewerId, eventId);
    const isHost = facts.hostRole !== null;
    // Private plans (D-179): the guest list is for people the host has let in.
    if (core.visibility === 'approval' && !isLetIn(facts)) {
      const seats = await this.store.seatCounts(eventId);
      return { items: [], hiddenCount: seats.seats };
    }
    const statuses = isHost
      ? (['going', 'checked_in', 'waitlisted'] as const)
      : (['going', 'checked_in'] as const);
    const rows = await this.db
      .select({
        userId: rsvps.userId,
        status: rsvps.status,
        plusOneOf: rsvps.plusOneOf,
        createdAt: rsvps.createdAt,
      })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), inArray(rsvps.status, [...statuses])))
      .orderBy(rsvps.createdAt);
    const ids = rows.map((r) => r.userId);
    const [shown, badge, firstTimers, cards, tiers] = await Promise.all([
      this.profiles.withPrivacyFlag(ids, 'showInWhoIsGoing'),
      this.profiles.withPrivacyFlag(ids, 'showFirstTimerBadge'),
      this.firstTimers(eventId, ids),
      this.people.cards(viewerId, ids, { includeSelf: true }),
      // Hosts see reliability tiers (F-SAF-02); nobody else does.
      isHost ? this.reliability.tiers(ids) : Promise.resolve(new Map<string, ReliabilityTier>()),
    ]);
    const hostIds = new Set(facts.hosts.map((h) => h.userId));
    let hidden = 0;
    const items = rows.flatMap((r) => {
      const person = cards.get(r.userId);
      const visible =
        person && (isHost || r.userId === viewerId || hostIds.has(r.userId) || shown.has(r.userId));
      if (!visible) {
        hidden += 1;
        return [];
      }
      return [
        {
          person,
          status: r.status,
          firstTime: firstTimers.has(r.userId) && badge.has(r.userId),
          plusOneOf: r.plusOneOf,
          isHost: hostIds.has(r.userId),
          reliabilityTier: isHost ? (tiers.get(r.userId) ?? 'new') : null,
        },
      ];
    });
    return { items, hiddenCount: hidden };
  }

  /** Who among `ids` has never checked in to any other plan. */
  private async firstTimers(eventId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ userId: rsvps.userId })
      .from(rsvps)
      .where(
        and(
          inArray(rsvps.userId, ids),
          eq(rsvps.status, 'checked_in'),
          sql`${rsvps.eventId} <> ${eventId}`,
        ),
      );
    const veterans = new Set(rows.map((r) => r.userId));
    return new Set(ids.filter((id) => !veterans.has(id)));
  }
}
