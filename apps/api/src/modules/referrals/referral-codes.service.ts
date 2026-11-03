import { Inject, Injectable } from '@nestjs/common';
import { isReferralCode, LIMITS } from '@touchgrass/shared';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { randomInviteCode } from '../../common/auth/hashing.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { referralCodes, referrals, users } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';

/** A friend's first check-in earned the referrer their rewards (gamification records the Plug badge fact). */
export const REFERRAL_REWARDED_EVENT = 'referral.rewarded';

const R = LIMITS.referrals;
const MAX_ATTEMPTS = 8;

/**
 * Referral codes and the sign-up side of referrals (F-GRW-01). Kept apart from rewards so the auth module can
 * use it without importing everything rewards depend on.
 */
@Injectable()
export class ReferralCodesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The person's permanent code, created on first use (collision-safe). */
  async codeFor(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ code: referralCodes.code })
      .from(referralCodes)
      .where(eq(referralCodes.userId, userId));
    if (existing) return existing.code;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const code = `${R.codePrefix}${randomInviteCode(R.codeLength)}`;
      const rows = await this.db
        .insert(referralCodes)
        .values({ userId, code })
        .onConflictDoNothing()
        .returning({ code: referralCodes.code });
      if (rows[0]) return rows[0].code;
      const [mine] = await this.db
        .select({ code: referralCodes.code })
        .from(referralCodes)
        .where(eq(referralCodes.userId, userId));
      if (mine) return mine.code;
    }
    throw new Error('Could not allocate a referral code');
  }

  /** Who a code belongs to, if it is a referral code of an active member. */
  async referrerFor(code: string, db: DbOrTx = this.db): Promise<string | null> {
    const normalized = code.trim().toUpperCase();
    if (!isReferralCode(normalized)) return null;
    const [row] = await db
      .select({ userId: referralCodes.userId })
      .from(referralCodes)
      .innerJoin(users, eq(users.id, referralCodes.userId))
      .where(and(eq(referralCodes.code, normalized), eq(users.status, 'active')));
    return row?.userId ?? null;
  }

  /**
   * Records who referred a new member at sign-up. Joining on the referrer's own phone earns nothing, and is
   * decided here because only sign-up knows both devices.
   */
  async attach(
    tx: Tx,
    input: {
      referrerId: string;
      refereeId: string;
      code: string;
      phoneHash: string;
      deviceId: string;
      sameDeviceAsReferrer: boolean;
    },
  ): Promise<void> {
    await tx
      .insert(referrals)
      .values({
        id: uuidv7(),
        referrerId: input.referrerId,
        refereeId: input.refereeId,
        code: input.code.trim().toUpperCase(),
        refereePhoneHash: input.phoneHash,
        refereeDeviceId: input.deviceId,
        status: input.sameDeviceAsReferrer ? 'rejected' : 'pending',
        rejectReason: input.sameDeviceAsReferrer ? 'SAME_DEVICE' : null,
      })
      .onConflictDoNothing();
  }
}
