'use client';

import { resources } from '@touchgrass/shared';
import { useActionState } from 'react';
import { type ChallengeActionState, createChallengeAction } from './actions';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
const label = 'flex flex-col gap-1 font-semibold';

/** New themed challenge: copy in all three languages, the window (IST), mode, criteria and reward. */
export function ChallengeForm({
  interests,
  badges,
}: {
  interests: { id: string; name: string }[];
  badges: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ChallengeActionState, FormData>(
    createChallengeAction,
    {
      error: null,
      created: null,
    },
  );
  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
      aria-label={t.newChallenge}
    >
      <h2 className="text-xl font-bold">{t.newChallenge}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label} htmlFor="ch-emoji">
          {t.emoji}
          <input id="ch-emoji" name="emoji" required maxLength={8} className={input} />
        </label>
        {(
          [
            ['titleEn', t.titleEn, 'en', 80],
            ['titleTe', t.titleTe, 'te', 80],
            ['titleHi', t.titleHi, 'hi', 80],
            ['descEn', t.descEn, 'en', 400],
            ['descTe', t.descTe, 'te', 400],
            ['descHi', t.descHi, 'hi', 400],
          ] as const
        ).map(([name, text, lang, max]) => (
          <label key={name} className={label} htmlFor={`ch-${name}`}>
            {text}
            <input
              id={`ch-${name}`}
              name={name}
              lang={lang}
              required
              maxLength={max}
              className={input}
            />
          </label>
        ))}
        <label className={label} htmlFor="ch-starts">
          {t.startsAt}
          <input id="ch-starts" name="startsAt" type="datetime-local" required className={input} />
        </label>
        <label className={label} htmlFor="ch-ends">
          {t.endsAt}
          <input id="ch-ends" name="endsAt" type="datetime-local" required className={input} />
        </label>
        <div className={label}>
          <label htmlFor="ch-mode">{t.mode}</label>
          <select id="ch-mode" name="mode" defaultValue="solo" className={input}>
            <option value="solo">{t.modeSolo}</option>
            <option value="group">{t.modeGroup}</option>
          </select>
        </div>
        <label className={label} htmlFor="ch-target">
          {t.target}
          <input
            id="ch-target"
            name="target"
            type="number"
            min={1}
            max={100}
            defaultValue={3}
            required
            className={input}
          />
        </label>
        <div className={label}>
          <label htmlFor="ch-distinct">{t.distinctBy}</label>
          <select id="ch-distinct" name="distinct" defaultValue="none" className={input}>
            <option value="none">{t.distinctNone}</option>
            <option value="venueId">{t.fields.venueId}</option>
            <option value="neighbourhoodId">{t.fields.neighbourhoodId}</option>
          </select>
        </div>
        <div className={label}>
          <label htmlFor="ch-category">{t.category}</label>
          <select id="ch-category" name="categoryInterestId" defaultValue="" className={input}>
            <option value="">{t.anyCategory}</option>
            {interests.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div className={label}>
          <label htmlFor="ch-reward">{t.rewardBadge}</label>
          <select id="ch-reward" name="rewardBadgeId" defaultValue="" className={input}>
            <option value="">{t.none}</option>
            {badges.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 font-semibold" htmlFor="ch-new">
          <input id="ch-new" name="newPlacesOnly" type="checkbox" className="h-6 w-6" />
          {t.newPlacesOnly}
        </label>
        <label className="flex min-h-11 items-center gap-2 font-semibold" htmlFor="ch-squad">
          <input id="ch-squad" name="withSquad" type="checkbox" className="h-6 w-6" />
          {t.withSquad}
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
