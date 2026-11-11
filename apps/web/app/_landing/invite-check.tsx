'use client';

import type { Translation } from '@touchgrass/shared';
import { useActionState } from 'react';
import { checkInviteAction, type InviteCheckState } from './actions';
import { StoreLinks } from './store-links';

const input =
  'min-h-11 w-full rounded-xl border-2 border-input bg-surface px-3 font-mono text-lg uppercase tracking-widest text-text';

export function InviteCheck({
  t,
  errors,
  playUrl,
  appStoreUrl,
}: {
  t: Translation['landing']['check'];
  errors: { RATE_LIMITED: string; INTERNAL: string };
  playUrl: string | null;
  appStoreUrl: string | null;
}) {
  const [state, action, pending] = useActionState<InviteCheckState, FormData>(checkInviteAction, {
    status: 'idle',
    code: null,
    inviterName: null,
    error: null,
  });
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label htmlFor="invite-code" className="flex grow flex-col gap-1 font-semibold">
          {t.label}
          <input
            id="invite-code"
            name="code"
            required
            minLength={4}
            maxLength={32}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={input}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50"
        >
          {t.submit}
        </button>
      </form>
      <div aria-live="polite" data-testid="invite-result">
        {state.status === 'valid' ? (
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-primary p-4">
            <p className="text-lg font-bold">{t.valid}</p>
            {state.inviterName ? <p>{t.validFrom.replace('{{name}}', state.inviterName)}</p> : null}
            <p className="font-semibold">{t.nextTitle}</p>
            <ol className="list-decimal space-y-1 pl-6">
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3.replace('{{code}}', state.code ?? '')}</li>
            </ol>
            <StoreLinks playUrl={playUrl} appStoreUrl={appStoreUrl} />
          </div>
        ) : null}
        {state.status === 'invalid' ? (
          <p className="rounded-2xl border-2 border-border p-4 font-semibold">{t.invalid}</p>
        ) : null}
        {state.status === 'error' ? (
          <p role="alert" className="font-semibold text-[var(--tg-danger)]">
            {state.error === 'RATE_LIMITED' ? errors.RATE_LIMITED : errors.INTERNAL}
          </p>
        ) : null}
      </div>
    </div>
  );
}
