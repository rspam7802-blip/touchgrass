import { z } from 'zod';
import { PersonCard } from './social';

/** Referral rewards (F-GRW-01). */
export const ReferralStatus = z.enum(['pending', 'rewarded', 'rejected']);
export type ReferralStatus = z.infer<typeof ReferralStatus>;
/** Why a referral earned nothing: the person was already rewarded for, or the same phone was. */
export const ReferralRejectReason = z.enum([
  'DUPLICATE_PHONE',
  'DUPLICATE_DEVICE',
  'SAME_DEVICE',
  'LIMIT_REACHED',
]);
export type ReferralRejectReason = z.infer<typeof ReferralRejectReason>;

export const ReferralItem = z.object({
  /** Null once the person has left TouchGrass. */
  person: PersonCard.nullable(),
  status: ReferralStatus,
  reason: ReferralRejectReason.nullable(),
  createdAt: z.iso.datetime(),
  rewardedAt: z.iso.datetime().nullable(),
});
export type ReferralItem = z.infer<typeof ReferralItem>;

export const ReferralBalance = z.object({
  priorityPasses: z.number().int(),
  credits: z.number().int(),
  /** A credit covers plans priced up to this much. */
  creditMaxPaise: z.number().int(),
});
export type ReferralBalance = z.infer<typeof ReferralBalance>;

export const MyReferrals = z.object({
  code: z.string(),
  link: z.url(),
  balance: ReferralBalance,
  /** What each friend's first check-in earns right now. */
  perReferral: z.object({ priorityPasses: z.number().int(), credits: z.number().int() }),
  items: z.array(ReferralItem),
});
export type MyReferrals = z.infer<typeof MyReferrals>;

export const PriorityPassResult = z.object({ position: z.number().int() });
export type PriorityPassResult = z.infer<typeof PriorityPassResult>;

/** Referral codes: the "TG" prefix plus six unambiguous characters. */
export const REFERRAL_CODE_RE = /^TG[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export function isReferralCode(code: string): boolean {
  return REFERRAL_CODE_RE.test(code.trim().toUpperCase());
}
