'use server';

import { randomUUID } from 'node:crypto';
import { ModerationItemDetail, SanctionKind } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AdminApiError, adminApi } from '../../../../../lib/admin-session';

const Resolve = z.object({
  id: z.uuid(),
  outcome: z.enum(['dismiss', 'remove']),
  note: z.string().trim().max(500).default(''),
  sanction: z.union([SanctionKind, z.literal('')]).default(''),
  days: z.string().default(''),
  reason: z.string().trim().max(500).default(''),
});

/** Release or take down the content, optionally acting on its owner (F-SAF-05). One audited call. */
export async function resolveItemAction(form: FormData): Promise<void> {
  const f = Resolve.parse(Object.fromEntries(form));
  const timed = f.sanction === 'mute' || f.sanction === 'suspend';
  const sanction = f.sanction
    ? {
        kind: f.sanction,
        days: timed ? Number(f.days) || 1 : null,
        reason: f.reason || f.note || 'Community guidelines',
      }
    : null;
  let error: string | null = null;
  try {
    await adminApi(
      `/v1/admin/moderation/items/${f.id}/resolve`,
      ModerationItemDetail,
      {
        method: 'POST',
        headers: { 'idempotency-key': `admin-resolve-${randomUUID()}` },
        body: JSON.stringify({ outcome: f.outcome, note: f.note, sanction }),
      },
      `/admin/moderation/${f.id}`,
    );
  } catch (err) {
    if (!(err instanceof AdminApiError)) throw err;
    error = err.code;
  }
  revalidatePath('/admin/moderation');
  redirect(error ? `/admin/moderation/${f.id}?error=${error}` : `/admin/moderation/${f.id}`);
}
