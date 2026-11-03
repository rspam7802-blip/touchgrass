import {
  type AuthResponse,
  type AuthTokens,
  normalizeE164,
  type OtpVerifyBody,
} from '@touchgrass/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { PlusOneClaimService } from '../events/plus-one/plus-one-claim.service.js';
import { ReferralCodesService } from '../referrals/referral-codes.service.js';
import { InvitesService } from '../invites/invites.service.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { type UserRow, UsersService } from '../users/users.service.js';
import { OtpService } from './otp.service.js';
import { SessionsService } from './sessions.service.js';

export const USER_SIGNED_UP_EVENT = 'user.signed_up';

export function normalizePhoneOrThrow(raw: string): string {
  const e164 = normalizeE164(raw);
  if (!e164)
    throw new AppError('VALIDATION_FAILED', 'Invalid phone number', [
      { path: 'phone', message: 'Invalid phone number', code: 'custom' },
    ]);
  return e164;
}

/** Statuses that may never sign in. */
const BLOCKED: Partial<Record<UserRow['status'], AppError>> = {
  age_blocked: new AppError('AGE_RESTRICTED', 'TouchGrass is for people 18 and over'),
  suspended: new AppError('ACCOUNT_SUSPENDED', 'Account suspended'),
  banned: new AppError('ACCOUNT_SUSPENDED', 'Account suspended'),
};

/** Phone OTP sign-in / sign-up with the invite gate (F-ACC-01, F-ACC-02). */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly invites: InvitesService,
    private readonly flags: FeatureFlagsService,
    private readonly outbox: OutboxService,
    private readonly plusOnes: PlusOneClaimService,
    private readonly referralCodes: ReferralCodesService,
  ) {}

  async requestOtp(
    rawPhone: string,
    ip: string | null,
  ): Promise<{ expiresAt: string; resendAfterSeconds: number }> {
    const phone = normalizePhoneOrThrow(rawPhone);
    const issued = await this.otp.issue(phone, ip);
    return {
      expiresAt: issued.expiresAt.toISOString(),
      resendAfterSeconds: issued.resendAfterSeconds,
    };
  }

  async verifyOtp(body: OtpVerifyBody, ip: string | null): Promise<AuthResponse> {
    const phone = normalizePhoneOrThrow(body.phone);
    const requestId = await this.otp.check(phone, body.code);
    const existing = await this.users.findByPhone(phone);

    if (existing) {
      const blocked = BLOCKED[existing.status];
      if (blocked) {
        await this.otp.consume(requestId, this.db);
        throw blocked;
      }
    }
    // A friend's referral code also gets you in (the referee's "skip the waitlist", F-GRW-01).
    const referrerId =
      !existing && body.inviteCode ? await this.referralCodes.referrerFor(body.inviteCode) : null;
    if (
      !existing &&
      !referrerId &&
      (await this.flags.isEnabled('invite_gate')) &&
      !body.inviteCode
    ) {
      // A friend's +1 claim link counts as an invite (F-EVT-07).
      const claimable = body.claimToken ? await this.plusOnes.pending(body.claimToken) : null;
      // Code stays valid so the user can add an invite code and retry without a new SMS.
      if (!claimable) throw new AppError('INVITE_REQUIRED', 'An invite code is required to join');
    }

    return this.db.transaction(async (tx) => {
      if (!(await this.otp.consume(requestId, tx)))
        throw new AppError('OTP_EXPIRED', 'Code already used');
      let user: UserRow;
      let isNewUser = false;
      if (existing) {
        user = existing;
        if (user.status === 'deletion_pending') {
          // Signing back in during the grace period cancels deletion (DPDP: user retains control).
          const profile = await this.profiles.get(user.id, tx);
          const status = profile?.onboardingCompletedAt ? 'active' : 'onboarding';
          await this.users.setStatus(user.id, status, tx, { deletionRequestedAt: null });
          user = { ...user, status, deletionRequestedAt: null };
        }
      } else {
        isNewUser = true;
        const gate = await this.flags.isEnabled('invite_gate');
        user = await this.users.createFromPhone(phone, null, tx);
        let inviterUserId: string | null = null;
        if (referrerId && body.inviteCode) {
          inviterUserId = referrerId;
          await this.referralCodes.attach(tx, {
            referrerId,
            refereeId: user.id,
            code: body.inviteCode,
            phoneHash: user.phoneHash ?? '',
            deviceId: body.device.deviceId,
            sameDeviceAsReferrer: await this.sessions.hasDevice(
              referrerId,
              body.device.deviceId,
              tx,
            ),
          });
        } else if (body.inviteCode && gate) {
          inviterUserId = (await this.invites.redeem(body.inviteCode, user.id, tx)).inviterUserId;
        } else if (body.inviteCode) {
          // Gate off: an invite still records who brought them, but a bad code must not block signup.
          inviterUserId = await this.invites.redeem(body.inviteCode, user.id, tx).then(
            (r) => r.inviterUserId,
            () => null,
          );
        }
        await this.profiles.ensure(user.id, tx);
        if (body.claimToken) {
          const seat = await this.plusOnes.redeem(body.claimToken, user.id, tx);
          inviterUserId ??= seat.inviterUserId;
        }
        if (inviterUserId) await this.users.setInvitedBy(user.id, inviterUserId, tx);
        await this.outbox.add(tx, {
          aggregateType: 'user',
          aggregateId: user.id,
          type: USER_SIGNED_UP_EVENT,
          payload: { invitedByUserId: inviterUserId },
        });
      }
      const roles = await this.users.rolesOf(user.id, tx);
      const tokens = await this.sessions.create(user.id, body.device, roles, ip, tx);
      const profile = await this.profiles.get(user.id, tx);
      return {
        ...tokens,
        isNewUser,
        user: {
          id: user.id,
          status: user.status,
          roles,
          onboardingComplete: Boolean(profile?.onboardingCompletedAt),
          tutorialComplete: Boolean(profile?.tutorialCompletedAt),
        },
      };
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const outcome = await this.sessions.refresh(refreshToken, (id) => this.users.rolesOf(id));
    if (outcome.kind === 'reuse_detected')
      throw new AppError('SESSION_REVOKED', 'Refresh token reuse detected; session revoked');
    if (outcome.kind === 'invalid') throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
    const status = await this.users.statusOf(outcome.userId);
    const blocked = status ? BLOCKED[status] : undefined;
    if (blocked || status === 'deleted' || status === 'deletion_pending') {
      await this.sessions.revokeAll(outcome.userId, 'status');
      throw blocked ?? new AppError('SESSION_REVOKED', 'Account is not active');
    }
    return outcome.tokens;
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(userId, sessionId, 'logout');
  }
}
