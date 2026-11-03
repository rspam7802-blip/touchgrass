import { FeatureFlagList, resources } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;

async function toggleFlag(form: FormData): Promise<void> {
  'use server';
  const key = z
    .string()
    .regex(/^[a-z_]+$/)
    .parse(form.get('key'));
  const enabled = form.get('enabled') === 'true';
  await adminApi(
    `/v1/admin/feature-flags/${key}`,
    z.object({ key: z.string(), enabled: z.boolean() }),
    { method: 'PUT', body: JSON.stringify({ enabled }) },
    '/admin/feature-flags',
  );
  revalidatePath('/admin/feature-flags');
}

export default async function FeatureFlagsPage() {
  if (!(await canOpen('featureFlags'))) return <NoAccess />;
  const flags = await adminApi(
    '/v1/admin/feature-flags',
    FeatureFlagList,
    {},
    '/admin/feature-flags',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.featureFlags}</h1>
      <ul className="flex flex-col gap-2">
        {flags.items.map((f) => (
          <li
            key={f.key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border px-4 py-2"
            data-testid={`flag-${f.key}`}
          >
            <span className="font-mono font-semibold">{f.key}</span>
            <span aria-live="polite">{f.enabled ? t.enabled : t.disabled}</span>
            <form action={toggleFlag}>
              <input type="hidden" name="key" value={f.key} />
              <input type="hidden" name="enabled" value={String(!f.enabled)} />
              <button
                type="submit"
                className="min-h-11 rounded-full bg-primary px-4 font-bold text-on-primary"
                aria-label={`${f.key}: ${t.toggle.replace('{{state}}', f.enabled ? t.disabled : t.enabled)}`}
              >
                {t.toggle.replace('{{state}}', f.enabled ? t.disabled : t.enabled)}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
