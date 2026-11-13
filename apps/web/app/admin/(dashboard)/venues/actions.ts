'use server';

import { guarded } from '../../../../lib/admin-action';

import { VenuePerk } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/venues';

const Partner = z.object({
  id: z.uuid(),
  isPartner: z.enum(['true', 'false']).transform((v) => v === 'true'),
  description: z.string().trim().max(500).default(''),
  staffPin: z.union([z.literal(''), z.string().regex(/^\d{4,8}$/)]),
});

export async function partnerAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const v = Partner.parse(Object.fromEntries(form));
    await adminApi(
      `/v1/admin/venues/${v.id}/partner`,
      z.undefined(),
      {
        method: 'PUT',
        body: JSON.stringify({
          isPartner: v.isPartner,
          description: v.description,
          ...(v.staffPin ? { staffPin: v.staffPin } : {}),
        }),
      },
      PATH,
    );
    revalidatePath(PATH);
  });
}

const NewPerk = z.object({
  venueId: z.uuid(),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).default(''),
  minGroupSize: z.coerce.number().int().min(1).max(50),
  validUntil: z.union([z.literal(''), z.iso.date()]),
});

export async function createPerkAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const p = NewPerk.parse(Object.fromEntries(form));
    await adminApi(
      `/v1/admin/venues/${p.venueId}/perks`,
      VenuePerk,
      {
        method: 'POST',
        body: JSON.stringify({
          title: p.title,
          description: p.description,
          minGroupSize: p.minGroupSize,
          // End of the chosen day in IST.
          validUntil: p.validUntil ? `${p.validUntil}T18:29:59.000Z` : null,
          active: true,
        }),
      },
      PATH,
    );
    revalidatePath(PATH);
  });
}

const TogglePerk = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  minGroupSize: z.coerce.number().int(),
  validUntil: z.string(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export async function togglePerkAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const p = TogglePerk.parse(Object.fromEntries(form));
    await adminApi(
      `/v1/admin/venues/perks/${p.id}`,
      VenuePerk,
      {
        method: 'PUT',
        body: JSON.stringify({
          title: p.title,
          description: p.description,
          minGroupSize: p.minGroupSize,
          validUntil: p.validUntil || null,
          active: p.active,
        }),
      },
      PATH,
    );
    revalidatePath(PATH);
  });
}
