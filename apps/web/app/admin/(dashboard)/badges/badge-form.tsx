'use client';

import { FactField, FactKind, resources } from '@touchgrass/shared';
import { useActionState } from 'react';
import { type BadgeActionState, createBadgeAction } from './actions';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
const label = 'flex flex-col gap-1 font-semibold';

/** New rule badge: names in all three languages and a rule built from the supported types. */
export function BadgeForm() {
  const [state, action, pending] = useActionState<BadgeActionState, FormData>(createBadgeAction, {
    error: null,
    created: null,
  });
  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
      aria-label={t.newBadge}
    >
      <h2 className="text-xl font-bold">{t.newBadge}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label} htmlFor="badge-key">
          {t.badgeKey}
          <input id="badge-key" name="key" required pattern="[a-z0-9_]{3,40}" className={input} />
        </label>
        <label className={label} htmlFor="badge-emoji">
          {t.emoji}
          <input id="badge-emoji" name="emoji" required maxLength={8} className={input} />
        </label>
        {(
          [
            ['nameEn', t.nameEn, 'en', 40],
            ['nameTe', t.nameTe, 'te', 40],
            ['nameHi', t.nameHi, 'hi', 40],
            ['descEn', t.descEn, 'en', 160],
            ['descTe', t.descTe, 'te', 160],
            ['descHi', t.descHi, 'hi', 160],
          ] as const
        ).map(([name, text, lang, max]) => (
          <label key={name} className={label} htmlFor={`badge-${name}`}>
            {text}
            <input
              id={`badge-${name}`}
              name={name}
              lang={lang}
              required
              maxLength={max}
              className={input}
            />
          </label>
        ))}
        <div className={label}>
          <label htmlFor="badge-rule">{t.rule}</label>
          <select id="badge-rule" name="ruleType" defaultValue="count" className={input}>
            <option value="count">{t.ruleCount}</option>
            <option value="distinct">{t.ruleDistinct}</option>
            <option value="group_count">{t.ruleGroup}</option>
          </select>
        </div>
        <div className={label}>
          <label htmlFor="badge-fact">{t.fact}</label>
          <select id="badge-fact" name="fact" defaultValue="check_in" className={input}>
            {FactKind.options.map((k) => (
              <option key={k} value={k}>
                {t.facts[k]}
              </option>
            ))}
          </select>
        </div>
        <div className={label}>
          <label htmlFor="badge-field">{t.field}</label>
          <select id="badge-field" name="field" defaultValue="neighbourhoodId" className={input}>
            {FactField.options.map((k) => (
              <option key={k} value={k}>
                {t.fields[k]}
              </option>
            ))}
          </select>
        </div>
        <label className={label} htmlFor="badge-threshold">
          {t.threshold}
          <input
            id="badge-threshold"
            name="threshold"
            type="number"
            min={1}
            max={1000}
            defaultValue={5}
            required
            className={input}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 font-semibold" htmlFor="badge-ontime">
          <input id="badge-ontime" name="onTimeOnly" type="checkbox" className="h-6 w-6" />
          {t.onTimeOnly}
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
        {t.save}
      </button>
    </form>
  );
}
