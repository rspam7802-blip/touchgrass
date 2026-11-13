'use client';

import type { SupportedLanguage, Translation } from '@touchgrass/shared';
import Link from 'next/link';
import { useActionState } from 'react';
import { joinWaitlistAction, type WaitlistField, type WaitlistState } from './actions';

const input = 'min-h-11 w-full rounded-xl border-2 border-input bg-surface px-3 text-text';
const label = 'flex flex-col gap-1 font-semibold';

export function WaitlistForm({
  t,
  errors,
  language,
  source = null,
  referral = null,
}: {
  t: Translation['landing']['waitlist'];
  errors: { RATE_LIMITED: string; INTERNAL: string };
  language: SupportedLanguage;
  /** The link's utm_source (D-191), e.g. instagram. */
  source?: string | null;
  /** A friend's referral code from the link (?ref=). */
  referral?: string | null;
}) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlistAction, {
    done: false,
    fields: [],
    error: null,
    values: { name: '', phone: '', email: '', city: 'Hyderabad', note: '', consent: false },
  });
  if (state.done)
    return (
      <p
        role="status"
        className="rounded-2xl border-2 border-primary p-4 text-lg font-bold"
        data-testid="waitlist-done"
      >
        {t.done}
      </p>
    );
  const invalid = (f: WaitlistField) => state.fields.includes(f);
  const describedBy = (f: WaitlistField, hint?: string) =>
    [hint, invalid(f) ? `waitlist-${f}-error` : null].filter(Boolean).join(' ') || undefined;
  const fieldError = (f: WaitlistField) =>
    invalid(f) ? (
      <span id={`waitlist-${f}-error`} className="font-semibold text-[var(--tg-danger)]">
        {t.errors[f]}
      </span>
    ) : null;
  const contactInvalid = invalid('contact');
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="language" value={language} />
      {source ? <input type="hidden" name="source" value={source} /> : null}
      {referral ? <input type="hidden" name="ref" value={referral} /> : null}
      {state.fields.length > 0 || state.error ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {state.error
            ? state.error === 'RATE_LIMITED'
              ? errors.RATE_LIMITED
              : errors.INTERNAL
            : state.fields.map((f) => t.errors[f]).join(' ')}
        </p>
      ) : null}
      <label htmlFor="waitlist-name" className={label}>
        {t.name}
        <input
          id="waitlist-name"
          name="name"
          required
          maxLength={60}
          autoComplete="name"
          defaultValue={state.values.name}
          aria-invalid={invalid('name') || undefined}
          aria-describedby={describedBy('name')}
          className={input}
        />
        {fieldError('name')}
      </label>
      <fieldset
        className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
        aria-describedby={describedBy('contact', 'waitlist-contact-hint')}
      >
        <legend className="px-1 font-semibold">{`${t.phone} / ${t.email}`}</legend>
        <p id="waitlist-contact-hint" className="text-muted">
          {t.contactHint}
        </p>
        {fieldError('contact')}
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="waitlist-phone" className={label}>
            {t.phone}
            <input
              id="waitlist-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              maxLength={20}
              autoComplete="tel-national"
              defaultValue={state.values.phone}
              aria-invalid={invalid('phone') || contactInvalid || undefined}
              aria-describedby={describedBy('phone')}
              className={input}
            />
            {fieldError('phone')}
          </label>
          <label htmlFor="waitlist-email" className={label}>
            {t.email}
            <input
              id="waitlist-email"
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              defaultValue={state.values.email}
              aria-invalid={invalid('email') || contactInvalid || undefined}
              aria-describedby={describedBy('email')}
              className={input}
            />
            {fieldError('email')}
          </label>
        </div>
      </fieldset>
      <label htmlFor="waitlist-city" className={label}>
        {t.city}
        <input
          id="waitlist-city"
          name="city"
          maxLength={60}
          autoComplete="address-level2"
          defaultValue={state.values.city}
          aria-invalid={invalid('city') || undefined}
          aria-describedby={describedBy('city')}
          className={input}
        />
        {fieldError('city')}
      </label>
      <label htmlFor="waitlist-note" className={label}>
        {t.note}
        <textarea
          id="waitlist-note"
          name="note"
          maxLength={200}
          rows={3}
          defaultValue={state.values.note}
          aria-describedby="waitlist-note-hint"
          className={`${input} py-2`}
        />
        <span id="waitlist-note-hint" className="font-normal text-muted">
          {t.noteHint}
        </span>
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="waitlist-consent" className="flex min-h-11 items-start gap-3">
          <input
            id="waitlist-consent"
            name="consent"
            type="checkbox"
            required
            defaultChecked={state.values.consent}
            aria-invalid={invalid('consent') || undefined}
            aria-describedby={describedBy('consent')}
            className="mt-1 size-6 shrink-0 accent-[var(--tg-primary)]"
          />
          <span>{t.consent}</span>
        </label>
        {fieldError('consent')}
        <Link href="/privacy" className="min-h-11 self-start py-2 font-semibold underline">
          {t.privacy}
        </Link>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50"
      >
        {t.submit}
      </button>
    </form>
  );
}
