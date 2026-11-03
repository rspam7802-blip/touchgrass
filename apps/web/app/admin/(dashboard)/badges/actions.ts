'use server';

import {
  AdminBadge,
  AdminBadgeList,
  BadgeRule,
  FactField,
  FactKind,
  UpsertBadgeBody,
} from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/badges';

const BadgeForm = z.object({
  key: z.string().trim(),
  emoji: z.string().trim(),
  nameEn: z.string().trim(),
  nameTe: z.string().trim(),
  nameHi: z.string().trim(),
  descEn: z.string().trim(),
  descTe: z.string().trim(),
  descHi: z.string().trim(),
  ruleType: z.enum(['count', 'distinct', 'group_count']),
  fact: FactKind,
  field: FactField.optional(),
  threshold: z.coerce.number().int(),
  onTimeOnly: z.literal('on').optional(),
});

export interface BadgeActionState {
  error: string | null;
  created: string | null;
}

/** Builds the rule from the form (the field only matters for "distinct" and "most in one group"). */
function ruleFrom(f: z.infer<typeof BadgeForm>): BadgeRule {
  return BadgeRule.parse(
    f.ruleType === 'count'
      ? { type: 'count', fact: f.fact, threshold: f.threshold, onTimeOnly: f.onTimeOnly === 'on' }
      : { type: f.ruleType, fact: f.fact, field: f.field ?? 'eventId', threshold: f.threshold },
  );
}

export async function createBadgeAction(
  _prev: BadgeActionState,
  form: FormData,
): Promise<BadgeActionState> {
  const parsed = BadgeForm.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      created: null,
    };
  const f = parsed.data;
  const body = UpsertBadgeBody.safeParse({
    key: f.key,
    emoji: f.emoji,
    name: { en: f.nameEn, te: f.nameTe, hi: f.nameHi },
    description: { en: f.descEn, te: f.descTe, hi: f.descHi },
    rule: ruleFrom(f),
    active: true,
  });
  if (!body.success)
    return {
      error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      created: null,
    };
  try {
    const badge = await adminApi(
      '/v1/admin/badges',
      AdminBadge,
      { method: 'POST', body: JSON.stringify(body.data) },
      PATH,
    );
    revalidatePath(PATH);
    return { error: null, created: badge.name.en };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), created: null };
  }
}

/** Turns a badge on or off; everything else is sent back unchanged. */
export async function toggleBadgeAction(form: FormData): Promise<void> {
  const id = z.uuid().parse(form.get('id'));
  const active = z.enum(['true', 'false']).parse(form.get('active')) === 'true';
  const list = await adminApi('/v1/admin/badges', AdminBadgeList, {}, PATH);
  const b = list.items.find((x) => x.id === id);
  if (!b) return;
  const body: UpsertBadgeBody = {
    key: b.key,
    name: b.name,
    description: b.description,
    emoji: b.emoji,
    rule: b.rule,
    active,
  };
  await adminApi(
    `/v1/admin/badges/${id}`,
    AdminBadge,
    { method: 'PUT', body: JSON.stringify(body) },
    PATH,
  );
  revalidatePath(PATH);
}
