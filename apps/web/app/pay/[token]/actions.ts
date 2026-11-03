'use server';

import { publicPost } from '../../../lib/public-api';

/** Development checkout (fake gateway): asks the API to play the bank. The API refuses in production. */
export async function simulateAction(
  token: string,
  outcome: 'success' | 'failure',
): Promise<{ ok: boolean }> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { ok: false };
  const res = await publicPost(`/v1/checkout/${token}/simulate`, { outcome }, null);
  return { ok: res.ok };
}
