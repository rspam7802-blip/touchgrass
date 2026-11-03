'use server';

import { RANKING_WEIGHT_KEYS, RankingWeights, RankingWeightsBody } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/weights';

export async function saveWeightsAction(form: FormData): Promise<void> {
  const body = RankingWeightsBody.parse(
    Object.fromEntries(RANKING_WEIGHT_KEYS.map((k) => [k, z.coerce.number().parse(form.get(k))])),
  );
  await adminApi(
    '/v1/admin/weights',
    RankingWeights,
    { method: 'PUT', body: JSON.stringify(body) },
    PATH,
  );
  revalidatePath(PATH);
}

export async function resetWeightsAction(): Promise<void> {
  await adminApi('/v1/admin/weights', RankingWeights, { method: 'DELETE' }, PATH);
  revalidatePath(PATH);
}
