'use server';

import { guarded } from '../../../../lib/admin-action';

import { UpsertCityBody, UpsertNeighbourhoodBody } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/cities';
const num = z.coerce.number();

function cityFrom(form: FormData): z.infer<typeof UpsertCityBody> {
  return UpsertCityBody.parse({
    slug: form.get('slug'),
    name: form.get('name'),
    centre: { lat: num.parse(form.get('lat')), lng: num.parse(form.get('lng')) },
    bounds: {
      south: num.parse(form.get('south')),
      west: num.parse(form.get('west')),
      north: num.parse(form.get('north')),
      east: num.parse(form.get('east')),
    },
    timezone: form.get('timezone'),
    launchStatus: form.get('launchStatus'),
    languages: form.getAll('languages'),
  });
}

export async function saveCityAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const id = z.union([z.literal(''), z.uuid()]).parse(form.get('id') ?? '');
    const body = cityFrom(form);
    await adminApi(
      id ? `/v1/admin/cities/${id}` : '/v1/admin/cities',
      z.object({ id: z.uuid() }),
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
        headers: id ? {} : { 'idempotency-key': `admin-city-${randomUUID()}` },
      },
      PATH,
    );
    revalidatePath(PATH);
  });
}

export async function addNeighbourhoodAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const cityId = z.uuid().parse(form.get('cityId'));
    const body = UpsertNeighbourhoodBody.parse({
      slug: form.get('slug'),
      name: form.get('name'),
      centroid: { lat: num.parse(form.get('lat')), lng: num.parse(form.get('lng')) },
      radiusKm: num.parse(form.get('radiusKm')),
    });
    await adminApi(
      `/v1/admin/cities/${cityId}/neighbourhoods`,
      z.object({ id: z.uuid() }),
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'idempotency-key': `admin-hood-${randomUUID()}` },
      },
      PATH,
    );
    revalidatePath(PATH);
  });
}
