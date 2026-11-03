'use server';

import { UpsertInterestBody, UpsertVibeTagBody } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/taxonomy';

export async function saveTaxonomyAction(form: FormData): Promise<void> {
  const kind = z.enum(['interests', 'vibe-tags']).parse(form.get('kind'));
  const id = z.union([z.literal(''), z.uuid()]).parse(form.get('id') ?? '');
  const raw = {
    slug: form.get('slug'),
    name: { en: form.get('nameEn'), te: form.get('nameTe'), hi: form.get('nameHi') },
    emoji: form.get('emoji'),
    sortOrder: z.coerce
      .number()
      .int()
      .parse(form.get('sortOrder') ?? 0),
    active: form.get('active') === 'on',
  };
  const body =
    kind === 'interests'
      ? UpsertInterestBody.parse({ ...raw, category: form.get('category') })
      : UpsertVibeTagBody.parse(raw);
  await adminApi(
    id ? `/v1/admin/taxonomy/${kind}/${id}` : `/v1/admin/taxonomy/${kind}`,
    z.object({ id: z.uuid() }),
    {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
      headers: id ? {} : { 'idempotency-key': `admin-taxonomy-${randomUUID()}` },
    },
    PATH,
  );
  revalidatePath(PATH);
}
