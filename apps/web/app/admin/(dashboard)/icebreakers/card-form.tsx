'use client';

import { resources } from '@touchgrass/shared';
import { useActionState } from 'react';
import { type ActionState, createAction } from './actions';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
const CATEGORIES = ['light', 'deep', 'playful', 'local'] as const;

export function CardForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createAction, {
    error: null,
    created: null,
  });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4">
      <h2 className="text-xl font-bold">{t.addIcebreaker}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['en', t.promptEn],
            ['te', t.promptTe],
            ['hi', t.promptHi],
          ] as const
        ).map(([name, label]) => (
          <label
            key={name}
            className="flex flex-col gap-1 font-semibold"
            htmlFor={`prompt-${name}`}
          >
            {label}
            <input
              id={`prompt-${name}`}
              name={name}
              lang={name}
              required
              maxLength={200}
              className={input}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 font-semibold" htmlFor="category">
          {t.icebreakerCategory}
          <select id="category" name="category" defaultValue="light" className={input}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.icebreakerCategories[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.error ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {t.error.replace('{{message}}', state.error)}
        </p>
      ) : null}
      {state.created ? (
        <output aria-live="polite" className="font-semibold">
          {t.saved}: {state.created}
        </output>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50"
      >
        {t.add}
      </button>
    </form>
  );
}
