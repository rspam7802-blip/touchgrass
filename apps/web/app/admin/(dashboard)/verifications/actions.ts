'use server';

import { randomUUID } from 'node:crypto';
import { AdminVerification, VerificationRejectReason } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AdminApiError, adminApi } from '../../../../lib/admin-session';

const Review = z.object({
  id: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.union([VerificationRejectReason, z.literal('')]).default(''),
});

/** Approve or reject a selfie (F-SAF-01). Rejections need a reason, which the person is told. */
export async function reviewVerificationAction(form: FormData): Promise<void> {
  const { id, decision, reason } = Review.parse(Object.fromEntries(form));
  let error: string | null = null;
  try {
    await adminApi(
      `/v1/admin/verifications/${id}/review`,
      AdminVerification,
      {
        method: 'POST',
        headers: { 'idempotency-key': `admin-verify-${randomUUID()}` },
        body: JSON.stringify({
          decision,
          reason: decision === 'rejected' ? reason || 'OTHER' : null,
        }),
      },
      '/admin/verifications',
    );
  } catch (err) {
    if (!(err instanceof AdminApiError)) throw err;
    error = err.code;
  }
  revalidatePath('/admin/verifications');
  redirect(error ? `/admin/verifications?error=${error}` : '/admin/verifications?done=1');
}
