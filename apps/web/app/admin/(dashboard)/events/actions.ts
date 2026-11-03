'use server';

import { AdminEventDetail, CreateEventBody } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const id = z.uuid();
/** `datetime-local` values are IST wall-clock times. */
const istLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(`${v}:00+05:30`).toISOString());

export async function updateEventAction(form: FormData): Promise<void> {
  const eventId = id.parse(form.get('id'));
  const body = z
    .object({
      title: z.string().trim().min(3).max(80),
      description: z.string().trim().max(2000),
      capacity: z.coerce.number().int().min(2).max(500),
    })
    .parse(Object.fromEntries(form));
  await adminApi(
    `/v1/admin/events/${eventId}`,
    AdminEventDetail,
    { method: 'PATCH', body: JSON.stringify(body) },
    `/admin/events/${eventId}`,
  );
  revalidatePath(`/admin/events/${eventId}`);
}

export async function featureEventAction(form: FormData): Promise<void> {
  const eventId = id.parse(form.get('id'));
  const until = istLocal.parse(form.get('until'));
  const rank = z.coerce.number().int().min(1).max(10).parse(form.get('rank'));
  await adminApi(
    `/v1/admin/events/${eventId}/feature`,
    AdminEventDetail,
    { method: 'PUT', body: JSON.stringify({ until, rank }) },
    `/admin/events/${eventId}`,
  );
  revalidatePath(`/admin/events/${eventId}`);
}

export async function unfeatureEventAction(form: FormData): Promise<void> {
  const eventId = id.parse(form.get('id'));
  await adminApi(`/v1/admin/events/${eventId}/feature`, z.undefined(), { method: 'DELETE' });
  revalidatePath(`/admin/events/${eventId}`);
}

export async function cancelEventAction(form: FormData): Promise<void> {
  const eventId = id.parse(form.get('id'));
  const reason = z.string().trim().min(3).max(300).parse(form.get('reason'));
  await adminApi(
    `/v1/admin/events/${eventId}/cancel`,
    AdminEventDetail,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
      headers: { 'idempotency-key': `admin-cancel-${randomUUID()}` },
    },
    `/admin/events/${eventId}`,
  );
  revalidatePath(`/admin/events/${eventId}`);
}

export async function createCuratedAction(form: FormData): Promise<void> {
  const v = Object.fromEntries(form);
  const venueId = z.union([z.literal(''), z.uuid()]).parse(v.venueId ?? '');
  const body = CreateEventBody.parse({
    type: 'curated',
    title: v.title,
    description: v.description ?? '',
    categoryInterestId: v.categoryInterestId,
    where: venueId
      ? { venueId }
      : {
          point: { lat: z.coerce.number().parse(v.lat), lng: z.coerce.number().parse(v.lng) },
          address: v.address,
          placeName: v.placeName || null,
        },
    startsAt: istLocal.parse(v.startsAt),
    endsAt: istLocal.parse(v.endsAt),
    capacity: z.coerce.number().parse(v.capacity),
    soloFriendly: v.soloFriendly === 'on',
    indoor: v.indoor === 'on',
    publish: v.publish === 'on',
  });
  const created = await adminApi(
    '/v1/admin/events',
    z.object({ id: z.uuid(), slug: z.string() }),
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': `admin-curated-${randomUUID()}` },
    },
    '/admin/events/new',
  );
  redirect(`/admin/events/${created.id}`);
}
