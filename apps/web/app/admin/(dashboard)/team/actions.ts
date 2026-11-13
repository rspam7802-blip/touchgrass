'use server';

import { guarded } from '../../../../lib/admin-action';

import { AdminUserList, GrantRoleBody } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AdminApiError, adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/team';

/**
 * The person to give a role to, from what an admin knows: their phone number (with or without +91), or the
 * user ID from their admin page. They must have signed up already.
 */
async function resolvePerson(input: string): Promise<string> {
  const value = input.trim();
  if (z.uuid().safeParse(value).success) return value;
  const digits = value.replace(/[^\d+]/g, '');
  const phone = digits.startsWith('+') ? digits : `+91${digits.replace(/^0+/, '').slice(-10)}`;
  if (!/^\+[1-9]\d{6,14}$/.test(phone))
    throw new AdminApiError('VALIDATION_FAILED', 'Enter their phone number or user ID.', 400);
  const found = await adminApi(`/v1/admin/users?q=${encodeURIComponent(phone)}`, AdminUserList);
  const [person] = found.items;
  if (!person)
    throw new AdminApiError(
      'NOT_FOUND',
      `Nobody has signed up with ${phone} yet. They need to sign up in the app first.`,
      404,
    );
  return person.id;
}

export async function grantRoleAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const cityId = z.union([z.literal(''), z.uuid()]).parse(form.get('cityId') ?? '');
    const body = GrantRoleBody.parse({
      userId: await resolvePerson(z.string().parse(form.get('userId') ?? '')),
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
  });
}

export async function revokeRoleAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const id = z.uuid().parse(form.get('id'));
    await adminApi(`/v1/admin/team/${id}`, z.undefined(), { method: 'DELETE' }, PATH);
    revalidatePath(PATH);
  });
}
