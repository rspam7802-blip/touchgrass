import { Inject, Injectable } from '@nestjs/common';
import type { MyReferrals, ReferralBalance, ReferralRejectReason } from '@touchgrass/shared';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  referralCodes,
  referralRewards,
  referralRewardUses,
  referrals,
} from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { RsvpService } from '../events/rsvp.service.js';
import type { CreditReservation } from '../payments/payment-credits.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { REFERRAL_REWARDED_EVENT, ReferralCodesService } from './referral-codes.service.js';

type ReferralRow = typeof referrals.$inferSelect;

/** Why a pending referral earns nothing, given what was already rewarded (pure, unit-tested). */
export function rejectReason(
  r: Pick<ReferralRow, 'refereePhoneHash' | 'refereeDeviceId'>,
  ctx: {
    phoneRewarded: boolean;
    deviceRewarded: boolean;
    referrerRewarded: number;
    maxRewarded: number;
  },
): ReferralRejectReason | null {
  if (ctx.phoneRewarded) return 'DUPLICATE_PHONE';
  if (r.refereeDeviceId && ctx.deviceRewarded) return 'DUPLICATE_DEVICE';
  if (ctx.referrerRewarded >= ctx.maxRewarded) return 'LIMIT_REACHED';
  return null;
}

/**
 * Referral rewards (F-GRW-01). When a referred friend checks in for the first time, the referrer earns
 * priority passes, free-entry credits and the Plug badge — once per phone number and per device, up to a
 * lifetime limit. Passes jump the waitlist; credits pay for a paid plan's ticket.
 */
@Injectable()
export class ReferralsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly codes: ReferralCodesService,
    private readonly outbox: OutboxService,
    private readonly settings: AppSettingsService,
    private readonly people: PeopleService,
    private readonly rsvp: RsvpService,
  ) {}

  async balance(userId: string): Promise<ReferralBalance> {
    const rows = await this.db
      .select()
      .from(referralRewards)
      .where(and(eq(referralRewards.userId, userId), gt(referralRewards.remaining, 0)));
    const credits = rows.filter((r) => r.kind === 'credit');
    return {
      priorityPasses: rows
        .filter((r) => r.kind === 'priority_pass')
        .reduce((n, r) => n + r.remaining, 0),
      credits: credits.reduce((n, r) => n + r.remaining, 0),
      creditMaxPaise: Math.max(0, ...credits.map((c) => c.maxPaise ?? 0)),
    };
  }

  async mine(userId: string): Promise<MyReferrals> {
    const [code, balance, all, rows] = await Promise.all([
      this.codes.codeFor(userId),
      this.balance(userId),
      this.settings.all(),
      this.db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId))
        .orderBy(desc(referrals.createdAt))
        .limit(100),
    ]);
    const cards = await this.people.cards(
      userId,
      rows.flatMap((r) => (r.refereeId ? [r.refereeId] : [])),
    );
    return {
      code,
      link: `${this.env.WEB_PUBLIC_URL}/?ref=${encodeURIComponent(code)}`,
      balance,
      perReferral: { priorityPasses: all.referral_priority_passes, credits: all.referral_credits },
      items: rows.map((r) => ({
        person: r.refereeId ? (cards.get(r.refereeId) ?? null) : null,
        status: r.status,
        reason: (r.rejectReason as ReferralRejectReason | null) ?? null,
        createdAt: r.createdAt.toISOString(),
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * A referred person checked in. Their pending referral is settled once: rejected by the fraud checks, or
   * rewarded. The unique indexes on rewarded phone/device back the checks up under concurrency.
   */
  async onCheckIn(
    refereeId: string,
    now: Date = new Date(),
  ): Promise<'rewarded' | 'rejected' | null> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(referrals)
        .where(and(eq(referrals.refereeId, refereeId), eq(referrals.status, 'pending')))
        .for('update');
      if (!r?.referrerId) return null;
      const all = await this.settings.all(tx);
      const [phone, device, count] = await Promise.all([
        tx.$count(
          referrals,
          and(eq(referrals.refereePhoneHash, r.refereePhoneHash), eq(referrals.status, 'rewarded')),
        ),
        r.refereeDeviceId
          ? tx.$count(
              referrals,
              and(
                eq(referrals.refereeDeviceId, r.refereeDeviceId),
                eq(referrals.status, 'rewarded'),
              ),
            )
          : Promise.resolve(0),
        tx.$count(
          referrals,
          and(eq(referrals.referrerId, r.referrerId), eq(referrals.status, 'rewarded')),
        ),
      ]);
      const reason = rejectReason(r, {
        phoneRewarded: phone > 0,
        deviceRewarded: device > 0,
        referrerRewarded: count,
        maxRewarded: all.referral_max_rewarded,
      });
      if (reason) {
        await tx
          .update(referrals)
          .set({ status: 'rejected', rejectReason: reason })
          .where(eq(referrals.id, r.id));
        return 'rejected';
      }
      await tx
        .update(referrals)
        .set({ status: 'rewarded', rewardedAt: now })
        .where(eq(referrals.id, r.id));
      if (all.referral_priority_passes > 0)
        await tx.insert(referralRewards).values({
          id: uuidv7(),
          userId: r.referrerId,
          referralId: r.id,
          kind: 'priority_pass',
          remaining: all.referral_priority_passes,
        });
      if (all.referral_credits > 0)
        await tx.insert(referralRewards).values({
          id: uuidv7(),
          userId: r.referrerId,
          referralId: r.id,
          kind: 'credit',
          remaining: all.referral_credits,
          maxPaise: all.referral_credit_max_rupees * 100,
        });
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: r.referrerId,
        type: REFERRAL_REWARDED_EVENT,
        payload: { referralId: r.id, referrerId: r.referrerId, refereeId },
      });
      return 'rewarded';
    });
  }

  /** Takes one unit from the oldest matching reward row, in the caller's transaction. */
  private async take(
    tx: Tx,
    userId: string,
    kind: 'priority_pass' | 'credit',
    minPaise = 0,
  ): Promise<string | null> {
    const [row] = await tx
      .select()
      .from(referralRewards)
      .where(
        and(
          eq(referralRewards.userId, userId),
          eq(referralRewards.kind, kind),
          gt(referralRewards.remaining, 0),
          kind === 'credit'
            ? sql`coalesce(${referralRewards.maxPaise}, 0) >= ${minPaise}`
            : sql`true`,
        ),
      )
      .orderBy(asc(referralRewards.createdAt))
      .limit(1)
      .for('update');
    if (!row) return null;
    await tx
      .update(referralRewards)
      .set({ remaining: sql`${referralRewards.remaining} - 1` })
      .where(eq(referralRewards.id, row.id));
    return row.id;
  }

  /** Spends a priority pass to move to the front of a plan's waitlist. */
  async usePriorityPass(userId: string, eventId: string): Promise<number> {
    return this.rsvp.jumpWaitlist(userId, eventId, async (tx) => {
      const rewardId = await this.take(tx, userId, 'priority_pass');
      if (!rewardId)
        throw new AppError('NOT_ELIGIBLE', 'No priority pass left', { reason: 'NO_PRIORITY_PASS' });
      await tx.insert(referralRewardUses).values({ id: uuidv7(), rewardId, userId, eventId });
    });
  }

  // ---------- credit provider (payments) ----------

  async reserveCredit(
    tx: Tx,
    userId: string,
    paymentId: string,
    eventId: string,
    pricePaise: number,
  ): Promise<CreditReservation> {
    const rewardId = await this.take(tx, userId, 'credit', pricePaise);
    if (!rewardId) {
      const anyCredit = await tx.$count(
        referralRewards,
        and(
          eq(referralRewards.userId, userId),
          eq(referralRewards.kind, 'credit'),
          gt(referralRewards.remaining, 0),
        ),
      );
      return anyCredit > 0 ? 'CREDIT_TOO_SMALL' : 'NO_CREDIT';
    }
    await tx
      .insert(referralRewardUses)
      .values({ id: uuidv7(), rewardId, userId, eventId, paymentId });
    return 'ok';
  }

  async restoreCredit(tx: Tx, paymentId: string): Promise<boolean> {
    const [use] = await tx
      .update(referralRewardUses)
      .set({ restoredAt: new Date() })
      .where(
        and(eq(referralRewardUses.paymentId, paymentId), isNull(referralRewardUses.restoredAt)),
      )
      .returning();
    if (!use) return false;
    await tx
      .update(referralRewards)
      .set({ remaining: sql`${referralRewards.remaining} + 1` })
      .where(eq(referralRewards.id, use.rewardId));
    return true;
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [code, sent, rewards, uses] = await Promise.all([
      this.db.select().from(referralCodes).where(eq(referralCodes.userId, userId)),
      this.db.select().from(referrals).where(eq(referrals.referrerId, userId)),
      this.db.select().from(referralRewards).where(eq(referralRewards.userId, userId)),
      this.db.select().from(referralRewardUses).where(eq(referralRewardUses.userId, userId)),
    ]);
    return {
      referrals: {
        code: code[0]?.code ?? null,
        referred: sent.map((r) => ({ status: r.status, createdAt: r.createdAt.toISOString() })),
        rewards: rewards.map((r) => ({ kind: r.kind, remaining: r.remaining })),
        used: uses.map((u) => ({ eventId: u.eventId, at: u.createdAt.toISOString() })),
      },
    };
  }

  /**
   * Codes, rewards and links to the account go. The referral rows themselves stay, unlinked, so the phone and
   * device checks still stop the same number from being rewarded twice.
   */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(referralCodes).where(eq(referralCodes.userId, userId));
    await tx.delete(referralRewardUses).where(eq(referralRewardUses.userId, userId));
    await tx.delete(referralRewards).where(eq(referralRewards.userId, userId));
    await tx.update(referrals).set({ referrerId: null }).where(eq(referrals.referrerId, userId));
    await tx.update(referrals).set({ refereeId: null }).where(eq(referrals.refereeId, userId));
  }
}
