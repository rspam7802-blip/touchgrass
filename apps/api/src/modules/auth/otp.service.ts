import { Inject, Injectable, Logger } from '@nestjs/common';
import { LIMITS } from '@touchgrass/shared';
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { SmsSender } from '../../adapters/sms/sms.port.js';
import { pepperedHash, randomNumericCode, safeEqualHex } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { otpRequests } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';

export interface OtpIssued {
  expiresAt: Date;
  resendAfterSeconds: number;
}

/**
 * Phone OTP (F-ACC-02): 6 digits, 5-minute TTL, at most 5 attempts per code, 30 s resend cooldown.
 * Codes are stored only as peppered HMACs bound to the phone number. Route-level rate limits
 * (per number and per IP) are applied in the controller.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly sms: SmsSender,
  ) {}

  private hash(phoneE164: string, code: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `otp:${phoneE164}:${code}`);
  }

  /** The App Store / Play review number (STORE_REVIEW_PHONE) signs in with STORE_REVIEW_OTP, not an SMS. */
  private isReviewNumber(phoneE164: string): boolean {
    return Boolean(
      this.env.STORE_REVIEW_PHONE &&
      this.env.STORE_REVIEW_OTP &&
      this.env.STORE_REVIEW_PHONE === phoneE164,
    );
  }

  async issue(phoneE164: string, ip: string | null, now: Date = new Date()): Promise<OtpIssued> {
    const [latest] = await this.db
      .select({ createdAt: otpRequests.createdAt })
      .from(otpRequests)
      .where(eq(otpRequests.phoneE164, phoneE164))
      .orderBy(desc(otpRequests.createdAt))
      .limit(1);
    if (latest && now.getTime() - latest.createdAt.getTime() < LIMITS.otp.resendAfterMs) {
      const wait = Math.ceil(
        (LIMITS.otp.resendAfterMs - (now.getTime() - latest.createdAt.getTime())) / 1000,
      );
      throw new AppError('RATE_LIMITED', 'Wait before requesting another code', {
        retryAfterSeconds: wait,
      });
    }
    const review = this.isReviewNumber(phoneE164);
    const code = review ? (this.env.STORE_REVIEW_OTP ?? '') : randomNumericCode(LIMITS.otp.length);
    const expiresAt = new Date(now.getTime() + LIMITS.otp.ttlMs);
    await this.db.transaction(async (tx) => {
      // A new code supersedes any outstanding one for this number.
      await tx
        .update(otpRequests)
        .set({ consumedAt: now })
        .where(and(eq(otpRequests.phoneE164, phoneE164), isNull(otpRequests.consumedAt)));
      await tx.insert(otpRequests).values({
        id: uuidv7(),
        phoneE164,
        codeHash: this.hash(phoneE164, code),
        expiresAt,
        requestIp: ip,
        createdAt: now,
      });
    });
    if (review) this.logger.log('Issued the store review sign-in code (no SMS sent)');
    else await this.sms.sendOtp(phoneE164, code);
    return { expiresAt, resendAfterSeconds: LIMITS.otp.resendAfterMs / 1000 };
  }

  /**
   * Checks a code against the outstanding request. Wrong codes burn an attempt; the 5th wrong attempt
   * invalidates the code. In non-production environments the documented dev code is also accepted.
   * Returns the request id so the caller can consume it inside its own transaction.
   */
  async check(phoneE164: string, code: string, now: Date = new Date()): Promise<string> {
    const [pending] = await this.db
      .select()
      .from(otpRequests)
      .where(and(eq(otpRequests.phoneE164, phoneE164), isNull(otpRequests.consumedAt)))
      .orderBy(desc(otpRequests.createdAt))
      .limit(1);
    if (!pending) throw new AppError('OTP_EXPIRED', 'No active code for this number');
    if (pending.expiresAt.getTime() <= now.getTime())
      throw new AppError('OTP_EXPIRED', 'Code expired');
    if (pending.attempts >= LIMITS.otp.maxAttempts)
      throw new AppError('OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');

    const devBypass = this.env.NODE_ENV !== 'production' && code === LIMITS.otp.devBypassCode;
    if (devBypass) this.logger.warn('Accepted development OTP bypass code');
    if (!devBypass && !safeEqualHex(this.hash(phoneE164, code), pending.codeHash)) {
      // Atomic increment guarded by the attempt cap, so parallel guesses cannot exceed it.
      const [updated] = await this.db
        .update(otpRequests)
        .set({ attempts: pending.attempts + 1 })
        .where(
          and(
            eq(otpRequests.id, pending.id),
            lt(otpRequests.attempts, LIMITS.otp.maxAttempts),
            eq(otpRequests.attempts, pending.attempts),
          ),
        )
        .returning({ attempts: otpRequests.attempts });
      if (!updated || updated.attempts >= LIMITS.otp.maxAttempts)
        throw new AppError('OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');
      throw new AppError('OTP_INVALID', 'Incorrect code', {
        attemptsRemaining: LIMITS.otp.maxAttempts - updated.attempts,
      });
    }
    return pending.id;
  }

  /** Marks the request consumed; returns false if someone else consumed it first (double submit). */
  async consume(requestId: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .update(otpRequests)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpRequests.id, requestId), isNull(otpRequests.consumedAt)))
      .returning({ id: otpRequests.id });
    return rows.length === 1;
  }

  /** Housekeeping: drop requests older than a day (worker, hourly). */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await this.db
      .delete(otpRequests)
      .where(lt(otpRequests.createdAt, cutoff))
      .returning({ id: otpRequests.id });
    return rows.length;
  }

  /** Exposed for tests and admin tooling: whether a number has an unexpired outstanding code. */
  async hasPending(phoneE164: string, now: Date = new Date()): Promise<boolean> {
    const rows = await this.db
      .select({ id: otpRequests.id })
      .from(otpRequests)
      .where(
        and(
          eq(otpRequests.phoneE164, phoneE164),
          isNull(otpRequests.consumedAt),
          gt(otpRequests.expiresAt, now),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
