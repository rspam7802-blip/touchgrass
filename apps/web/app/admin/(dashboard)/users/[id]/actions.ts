'use server';

import { guarded } from '../../../../../lib/admin-action';

import { randomUUID } from 'node:crypto';
import { AdminUserDetail, SanctionKind } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AdminApiError, adminApi } from '../../../../../lib/admin-session';

async function call(userId: string, path: string, body: unknown): Promise<void> {
  let error: string | null = null;
  try {
    await adminApi(
      path,
      AdminUserDetail,
      {
        method: 'POST',
        headers: { 'idempotency-key': `admin-user-${randomUUID()}` },
        body: JSON.stringify(body),
      },
      `/admin/users/${userId}`,
    );
  } catch (err) {
    if (!(err instanceof AdminApiError)) throw err;
    error = err.code;
  }
  revalidatePath(`/admin/users/${userId}`);
  redirect(error ? `/admin/users/${userId}?error=${error}` : `/admin/users/${userId}`);
}

const Sanction = z.object({
  userId: z.uuid(),
  kind: SanctionKind,
  days: z.string().default(''),
  reason: z.string().trim().min(3).max(500),
});

/** Warn, mute, suspend or ban (F-SAF-05); audited by the API. */
export async function sanctionAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const f = Sanction.parse(Object.fromEntries(form));
    const timed = f.kind === 'mute' || f.kind === 'suspend';
    await call(f.userId, `/v1/admin/users/${f.userId}/sanctions`, {
      kind: f.kind,
      days: timed ? Number(f.days) || 1 : null,
      reason: f.reason,
    });
  });
}

const Lift = z.object({ userId: z.uuid(), sanctionId: z.uuid() });

export async function liftAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const f = Lift.parse(Object.fromEntries(form));
    await call(f.userId, `/v1/admin/sanctions/${f.sanctionId}/lift`, {});
  });
}

const Verify = z.object({ userId: z.uuid(), verified: z.enum(['true', 'false']) });

export async function setVerifiedAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const f = Verify.parse(Object.fromEntries(form));
    await call(f.userId, `/v1/admin/users/${f.userId}/verification`, {
      verified: f.verified === 'true',
    });
  });
}
