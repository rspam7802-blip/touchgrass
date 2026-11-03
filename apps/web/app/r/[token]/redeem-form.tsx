'use client';

import type { Translation } from '@touchgrass/shared';
import { useActionState } from 'react';
import { redeemAction, type RedeemState } from './actions';

export function RedeemForm({ token, t }: { token: string; t: Translation }) {
  const [state, action, pending] = useActionState<RedeemState, FormData>(redeemAction, {
    done: null,
    error: null,
  });
  if (state.done)
    return (
      <p role="status" className="text-2xl font-bold text-primary" data-testid="perk-done">
        {t.perks.staffDone}
      </p>
    );
  const reasons = t.events.reasons as Record<string, string>;
  const errors = t.errors as Record<string, string>;
  const message = state.error
    ? (reasons[state.error] ?? errors[state.error] ?? errors.INTERNAL)
    : null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="pin" className="flex flex-col gap-1 font-semibold">
        {t.perks.staffPin}
        <input
          id="pin"
          name="pin"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4,8}"
          required
          className="min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-2xl tracking-widest text-text"
        />
      </label>
      {message ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50"
      >
        {t.perks.staffConfirm}
      </button>
    </form>
  );
}
