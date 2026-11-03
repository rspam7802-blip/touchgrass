'use client';

import { resources } from '@touchgrass/shared';
import { useActionState } from 'react';
import { type ActionState, bulkCreateAction } from './actions';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';

export function BulkForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(bulkCreateAction, {
    error: null,
    created: [],
  });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4">
      <h2 className="text-xl font-bold">{t.bulkTitle}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-semibold" htmlFor="count">
          {t.count}
          <input
            id="count"
            name="count"
            type="number"
            min={1}
            max={500}
            defaultValue={10}
            required
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold" htmlFor="maxUses">
          {t.maxUses}
          <input
            id="maxUses"
            name="maxUses"
            type="number"
            min={1}
            max={10000}
            defaultValue={1}
            required
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold" htmlFor="label">
          {t.label}
          <input id="label" name="label" required maxLength={60} className={input} />
        </label>
        <label className="flex flex-col gap-1 font-semibold" htmlFor="expiresOn">
          {t.expiresAt}
          <input id="expiresOn" name="expiresOn" type="date" className={input} />
        </label>
      </div>
      {state.error ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {t.error.replace('{{message}}', state.error)}
        </p>
      ) : null}
      {state.created.length > 0 ? (
        <output className="font-mono" aria-live="polite">
          {state.created.join('  ')}
        </output>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50"
      >
        {t.generate}
      </button>
    </form>
  );
}
