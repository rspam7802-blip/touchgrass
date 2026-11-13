'use server';

import { guarded } from '../../../../lib/admin-action';

import { InviteCode } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const BulkForm = z.object({
  count: z.coerce.number().int().min(1).max(500),
  maxUses: z.coerce.number().int().min(1).max(10_000),
  label: z.string().trim().min(1).max(60),
  expiresOn: z.union([z.literal(''), z.iso.date()]),
});

export interface ActionState {
  error: string | null;
  created: string[];
}

export async function bulkCreateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = BulkForm.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      created: [],
    };
  const { count, maxUses, label, expiresOn } = parsed.data;
  const res = await adminApi(
    '/v1/admin/invite-codes/bulk',
    z.object({ items: z.array(InviteCode) }),
    {
      method: 'POST',
      headers: { 'idempotency-key': `bulk-${randomUUID()}` },
      // End of the chosen day in IST.
      body: JSON.stringify({
        count,
        maxUses,
        label,
        expiresAt: expiresOn ? `${expiresOn}T18:29:59.000Z` : null,
      }),
    },
    '/admin/invite-codes',
  );
  revalidatePath('/admin/invite-codes');
  return { error: null, created: res.items.map((i) => i.code) };
}

export async function revokeAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const id = z.uuid().parse(form.get('id'));
    await adminApi(
      `/v1/admin/invite-codes/${id}/revoke`,
      InviteCode,
      { method: 'POST' },
      '/admin/invite-codes',
    );
    revalidatePath('/admin/invite-codes');
  });
}
