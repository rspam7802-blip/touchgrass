import { z } from 'zod';

export const FeatureFlag = z.object({
  key: z.string(),
  enabled: z.boolean(),
  description: z.string(),
});
export const FeatureFlagList = z.object({ items: z.array(FeatureFlag) });
export const UpdateFeatureFlagBody = z.object({
  enabled: z.boolean(),
  description: z.string().max(200).optional(),
});

/** Admin-tunable numeric settings (no code change needed). */
export const APP_SETTING_KEYS = [
  'invites_per_user',
  'waitlist_claim_minutes',
  /** Platform fee on ticket sales, basis points (1000 = 10%). */
  'platform_fee_bps',
  /** Hours after a paid plan ends before its payout is released. */
  'payout_delay_hours',
  /** Priority passes the referrer gets when a referred friend checks in for the first time. */
  'referral_priority_passes',
  /** Free-entry credits per rewarded referral (0 turns credits off). */
  'referral_credits',
  /** Most a free-entry credit covers, in rupees (plans priced above it can't use one). */
  'referral_credit_max_rupees',
  /** Rewarded referrals per person, lifetime. */
  'referral_max_rewarded',
] as const;
export const AppSettingKey = z.enum(APP_SETTING_KEYS);
export type AppSettingKey = z.infer<typeof AppSettingKey>;
export const UpdateAppSettingBody = z.object({ value: z.number().int().min(0).max(1000) });
export const AppSettings = z.object({
  items: z.array(z.object({ key: AppSettingKey, value: z.number().int() })),
});

export const AuditEntry = z.object({
  id: z.uuid(),
  adminUserId: z.uuid(),
  adminName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export type UpdateFeatureFlagBody = z.infer<typeof UpdateFeatureFlagBody>;
export type UpdateAppSettingBody = z.infer<typeof UpdateAppSettingBody>;
