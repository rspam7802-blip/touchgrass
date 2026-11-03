'use server';

import { PerkPassPreview } from '@touchgrass/shared';
import { z } from 'zod';
import { publicPost } from '../../../lib/public-api';

const Form = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
  pin: z.string().regex(/^\d{4,8}$/),
});

export interface RedeemState {
  done: PerkPassPreview | null;
  /** Translation key under events.reasons / errors. */
  error: string | null;
}

/** Venue staff confirm a perk with the venue PIN (F-PAY-04). */
export async function redeemAction(_prev: RedeemState, form: FormData): Promise<RedeemState> {
  const parsed = Form.safeParse({ token: form.get('token'), pin: form.get('pin') });
  if (!parsed.success) return { done: null, error: 'WRONG_PIN' };
  const { token, pin } = parsed.data;
  const res = await publicPost('/v1/perk-passes/redeem', { token, pin }, PerkPassPreview);
  if (res.ok) return { done: res.data, error: null };
  return { done: null, error: res.reason ?? res.code };
}
