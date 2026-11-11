'use client';

import { resources } from '@touchgrass/shared';
import { useActionState, useState } from 'react';
import { type InviteState, inviteAction, removeAction } from './actions';

const t = resources.en.admin.waitlist;
const button = 'min-h-11 rounded-full border-2 border-border px-4 font-semibold';

export function InviteButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {
    code: null,
    emailedTo: null,
    error: null,
  });
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {state.code ? (
        <div className="flex flex-col gap-1" data-testid="waitlist-new-code">
          <span className="text-sm font-semibold">{t.codeFor.replace('{{name}}', name)}</span>
          <output className="select-all rounded-xl border-2 border-primary px-3 py-2 font-mono text-lg font-bold tracking-widest">
            {state.code}
          </output>
          <span className="text-sm">
            {state.emailedTo ? t.emailed.replace('{{email}}', state.emailedTo) : t.sendYourself}
          </span>
        </div>
      ) : (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-full bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
            aria-label={t.inviteName.replace('{{name}}', name)}
          >
            {t.invite}
          </button>
        </form>
      )}
      {state.error ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {resources.en.admin.error.replace('{{message}}', state.error)}
        </p>
      ) : null}
    </div>
  );
}

export function RemoveButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button
        type="button"
        className={button}
        aria-label={t.removeName.replace('{{name}}', name)}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {t.remove}
      </button>
    );
  return (
    <form action={removeAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="font-semibold">{t.confirmRemove.replace('{{name}}', name)}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-full bg-[var(--tg-danger)] px-4 font-bold text-[var(--tg-on-danger)]"
        >
          {t.confirm}
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            setConfirming(false);
          }}
        >
          {t.keep}
        </button>
      </div>
    </form>
  );
}
