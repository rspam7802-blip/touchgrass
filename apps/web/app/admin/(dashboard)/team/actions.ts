'use server';

import { GrantRoleBody } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/team';

export async function grantRoleAction(form: FormData): Promise<void> {
  const cityId = z.union([z.literal(''), z.uuid()]).parse(form.get('cityId') ?? '');
  const body = GrantRoleBody.parse({
    userId: form.get('userId'),
    role: form.get('role'),
    cityId: cityId || null,
  });
  await adminApi(
    '/v1/admin/team',
    z.object({ ok: z.literal(true) }),
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': `admin-team-${randomUUID()}` },
    },
    PATH,
  );
  revalidatePath(PATH);
}

export async function revokeRoleAction(form: FormData): Promise<void> {
  const id = z.uuid().parse(form.get('id'));
  await adminApi(`/v1/admin/team/${id}`, z.undefined(), { method: 'DELETE' }, PATH);
  revalidatePath(PATH);
}
