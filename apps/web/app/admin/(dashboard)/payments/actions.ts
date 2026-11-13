'use server';

import { guarded } from '../../../../lib/admin-action';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const Retry = z.object({ kind: z.enum(['refunds', 'payouts']), id: z.uuid() });

export async function retryAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const { kind, id } = Retry.parse(Object.fromEntries(form));
    await adminApi(
      `/v1/admin/${kind}/${id}/retry`,
      z.undefined(),
      { method: 'POST' },
      '/admin/payments',
    );
    revalidatePath('/admin/payments');
  });
}
