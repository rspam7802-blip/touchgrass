'use server';

import {
  IcebreakerCard,
  IcebreakerCategory,
  IcebreakerDeck,
  UpsertIcebreakerBody,
} from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminApi } from '../../../../lib/admin-session';

const PATH = '/admin/icebreakers';

const CardForm = z.object({
  en: z.string().trim().min(1).max(200),
  te: z.string().trim().min(1).max(200),
  hi: z.string().trim().min(1).max(200),
  category: IcebreakerCategory,
});

export interface ActionState {
  error: string | null;
  created: string | null;
}

export async function createAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = CardForm.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      created: null,
    };
  const { en, te, hi, category } = parsed.data;
  const body: UpsertIcebreakerBody = { prompt: { en, te, hi }, category, active: true };
  const card = await adminApi(
    '/v1/admin/icebreakers',
    IcebreakerCard,
    { method: 'POST', body: JSON.stringify(body) },
    PATH,
  );
  revalidatePath(PATH);
  return { error: null, created: card.prompt.en };
}

/** Turns a card on or off; the rest of the card is sent back unchanged. */
export async function toggleAction(form: FormData): Promise<void> {
  const id = z.uuid().parse(form.get('id'));
  const active = z.enum(['true', 'false']).parse(form.get('active')) === 'true';
  const deck = await adminApi('/v1/admin/icebreakers', IcebreakerDeck, {}, PATH);
  const card = deck.items.find((c) => c.id === id);
  if (!card) return;
  const body: UpsertIcebreakerBody = { prompt: card.prompt, category: card.category, active };
  await adminApi(
    `/v1/admin/icebreakers/${id}`,
    IcebreakerCard,
    { method: 'PUT', body: JSON.stringify(body) },
    PATH,
  );
  revalidatePath(PATH);
}
