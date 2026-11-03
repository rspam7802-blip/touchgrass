import { Inject, Injectable } from '@nestjs/common';
import { type AppSettingKey, APP_SETTING_KEYS, LIMITS } from '@touchgrass/shared';
import { inArray } from 'drizzle-orm';
import { DB, type Database } from '../../infra/database/database.module.js';
import { appSettings } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';

export const APP_SETTING_DEFAULTS: Record<AppSettingKey, number> = {
  invites_per_user: LIMITS.invites.defaultPerUser,
  waitlist_claim_minutes: LIMITS.waitlist.claimWindowMs / 60_000,
  platform_fee_bps: LIMITS.payments.defaultPlatformFeeBps,
  payout_delay_hours: LIMITS.payments.defaultPayoutDelayHours,
  referral_priority_passes: LIMITS.referrals.defaultPriorityPasses,
  referral_credits: LIMITS.referrals.defaultCredits,
  referral_credit_max_rupees: LIMITS.referrals.defaultCreditMaxRupees,
  referral_max_rewarded: LIMITS.referrals.defaultMaxRewarded,
};

/** Admin-tunable numeric settings (e.g. invites per user). Missing rows fall back to defaults. */
@Injectable()
export class AppSettingsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async all(db: DbOrTx = this.db): Promise<Record<AppSettingKey, number>> {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, [...APP_SETTING_KEYS]));
    const out = { ...APP_SETTING_DEFAULTS };
    for (const row of rows) out[row.key as AppSettingKey] = row.value;
    return out;
  }

  async get(key: AppSettingKey, db: DbOrTx = this.db): Promise<number> {
    return (await this.all(db))[key];
  }

  async set(key: AppSettingKey, value: number, db: DbOrTx = this.db): Promise<void> {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }
}
