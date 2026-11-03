'use server';

import { HostApplication } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const Review = z.object({
  id: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).default(''),
});

export async function reviewAction(form: FormData): Promise<void> {
  const { id, decision, note } = Review.parse(Object.fromEntries(form));
  await adminApi(
    `/v1/admin/host-applications/${id}/review`,
    HostApplication,
    { method: 'POST', body: JSON.stringify({ decision, note }) },
    '/admin/host-applications',
  );
  revalidatePath('/admin/host-applications');
}
