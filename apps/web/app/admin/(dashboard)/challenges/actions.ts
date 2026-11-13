'use server';

import { guarded } from '../../../../lib/admin-action';

import { AdminChallenge, AdminChallengeList, UpsertChallengeBody } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/challenges';
const IST_OFFSET_MS = 330 * 60_000;

/** "2026-11-01T09:00" typed in IST (datetime-local) → ISO instant. */
function istLocal(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS).toISOString();
}

const ChallengeForm = z.object({
  emoji: z.string().trim(),
  titleEn: z.string().trim(),
  titleTe: z.string().trim(),
  titleHi: z.string().trim(),
  descEn: z.string().trim(),
  descTe: z.string().trim(),
  descHi: z.string().trim(),
  startsAt: z.string(),
  endsAt: z.string(),
  mode: z.enum(['solo', 'group']),
  target: z.coerce.number().int(),
  distinct: z.enum(['none', 'venueId', 'neighbourhoodId']),
  categoryInterestId: z.string(),
  rewardBadgeId: z.string(),
  newPlacesOnly: z.literal('on').optional(),
  withSquad: z.literal('on').optional(),
});

export interface ChallengeActionState {
  error: string | null;
  created: string | null;
}

export async function createChallengeAction(
  _prev: ChallengeActionState,
  form: FormData,
): Promise<ChallengeActionState> {
  const parsed = ChallengeForm.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      created: null,
    };
  const f = parsed.data;
  const body = UpsertChallengeBody.safeParse({
    emoji: f.emoji,
    title: { en: f.titleEn, te: f.titleTe, hi: f.titleHi },
    description: { en: f.descEn, te: f.descTe, hi: f.descHi },
    startsAt: istLocal(f.startsAt),
    endsAt: istLocal(f.endsAt),
    mode: f.mode,
    criteria: {
      target: f.target,
      distinct: f.distinct === 'none' ? null : f.distinct,
      categoryInterestId: f.categoryInterestId === '' ? null : f.categoryInterestId,
      newPlacesOnly: f.newPlacesOnly === 'on',
      withSquad: f.withSquad === 'on',
    },
    rewardBadgeId: f.rewardBadgeId === '' ? null : f.rewardBadgeId,
    active: true,
  });
  if (!body.success)
    return {
      error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      created: null,
    };
  try {
    const c = await adminApi(
      '/v1/admin/challenges',
      AdminChallenge,
      { method: 'POST', body: JSON.stringify(body.data) },
      PATH,
    );
    revalidatePath(PATH);
    return { error: null, created: c.title.en };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), created: null };
  }
}

export async function toggleChallengeAction(form: FormData): Promise<void> {
  await guarded(async () => {
    const id = z.uuid().parse(form.get('id'));
    const active = z.enum(['true', 'false']).parse(form.get('active')) === 'true';
    const list = await adminApi('/v1/admin/challenges', AdminChallengeList, {}, PATH);
    const c = list.items.find((x) => x.id === id);
    if (!c) return;
    const body: UpsertChallengeBody = {
      title: c.title,
      description: c.description,
      emoji: c.emoji,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      mode: c.mode,
      criteria: c.criteria,
      rewardBadgeId: c.rewardBadgeId,
      active,
    };
    await adminApi(
      `/v1/admin/challenges/${id}`,
      AdminChallenge,
      { method: 'PUT', body: JSON.stringify(body) },
      PATH,
    );
    revalidatePath(PATH);
  });
}
