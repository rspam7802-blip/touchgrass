import { AppSettingKey, AppSettings, resources } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const LABELS: Record<AppSettingKey, string> = {
  invites_per_user: t.invitesPerUser,
  waitlist_claim_minutes: t.waitlistClaimMinutes,
  platform_fee_bps: t.platformFeeBps,
  payout_delay_hours: t.payoutDelayHours,
  referral_priority_passes: t.referralPriorityPasses,
  referral_credits: t.referralCredits,
  referral_credit_max_rupees: t.referralCreditMaxRupees,
  referral_max_rewarded: t.referralMaxRewarded,
};

async function saveSetting(form: FormData): Promise<void> {
  'use server';
  const key = AppSettingKey.parse(form.get('key'));
  const value = z.coerce.number().int().min(0).max(1000).parse(form.get('value'));
  await adminApi(
    `/v1/admin/settings/${key}`,
    z.object({ key: z.string(), value: z.number() }),
    { method: 'PUT', body: JSON.stringify({ value }) },
    '/admin/settings',
  );
  revalidatePath('/admin/settings');
}

export default async function SettingsPage() {
  if (!(await canOpen('settings'))) return <NoAccess />;
  const settings = await adminApi('/v1/admin/settings', AppSettings, {}, '/admin/settings');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.settings}</h1>
      {settings.items.map((s) => (
        <form
          key={s.key}
          action={saveSetting}
          aria-label={LABELS[s.key]}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="key" value={s.key} />
          <label className="flex flex-col gap-1 font-semibold" htmlFor={s.key}>
            {LABELS[s.key]}
            <input
              id={s.key}
              name="value"
              type="number"
              min={0}
              max={1000}
              defaultValue={s.value}
              className="min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary"
          >
            {t.save}
          </button>
        </form>
      ))}
    </>
  );
}
