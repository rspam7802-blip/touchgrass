'use client';

import { normalizeE164, resources } from '@touchgrass/shared';
import type { ConfirmationResult } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { type FirebaseWebConfig, firebaseProblem } from '../../../lib/firebase-web';

const t = resources.en.admin;
const RECAPTCHA_ID = 'admin-recaptcha';

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Admin sign-in. With a Firebase web app configured (production, `SMS_PROVIDER=none`), Firebase texts and
 * checks the code and the API receives only its proof (D-167); otherwise the API texts its own code.
 */
export function LoginForm({ firebase }: { firebase: FirebaseWebConfig | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);

  /** Posts to the console's sign-in route; true when it worked, otherwise shows why. */
  const call = async (body: Record<string, string>): Promise<boolean> => {
    const res = await fetch('/admin/api/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    setError(
      data.error?.code === 'FORBIDDEN' ? t.notAdmin : (data.error?.message ?? res.statusText),
    );
    return false;
  };

  const showFirebaseError = (err: unknown) => {
    const problem = firebaseProblem(err);
    setError(
      problem === 'badPhone' ? t.phoneInvalid : problem === 'other' ? t.signInFailed : t[problem],
    );
  };

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!firebase) {
        setSent(await call({ step: 'request', phone }));
        return;
      }
      const e164 = normalizeE164(phone);
      if (!e164) {
        setError(t.phoneInvalid);
        return;
      }
      try {
        const { sendFirebaseCode } = await import('./firebase-phone');
        confirmation.current = await sendFirebaseCode(firebase, e164, RECAPTCHA_ID);
        setSent(true);
      } catch (err) {
        showFirebaseError(err);
      }
    });

  const verify = () =>
    run(async () => {
      let ok: boolean;
      if (!firebase || !confirmation.current) {
        ok = await call({ step: 'verify', phone, code });
      } else {
        let token: string;
        try {
          const { firebaseProof } = await import('./firebase-phone');
          token = await firebaseProof(confirmation.current, code);
        } catch (err) {
          showFirebaseError(err);
          return;
        }
        ok = await call({ step: 'proof', token });
      }
      if (ok) router.replace('/admin');
    });

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-extrabold">{t.title}</h1>
      <p className="text-muted">{t.signInBody}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (sent ? verify() : sendCode());
        }}
      >
        <label className="flex flex-col gap-1 font-semibold" htmlFor="phone">
          {t.phone}
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            readOnly={sent && firebase !== null}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            className="min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text"
          />
        </label>
        {sent ? (
          <label className="flex flex-col gap-1 font-semibold" htmlFor="code">
            {t.code}
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              className="min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text"
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="font-semibold text-[var(--tg-danger)]">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary disabled:opacity-50"
        >
          {sent ? t.verify : t.sendCode}
        </button>
        {firebase ? <div id={RECAPTCHA_ID} /> : null}
      </form>
    </main>
  );
}
