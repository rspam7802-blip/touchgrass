'use client';

import { resources } from '@touchgrass/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const t = resources.en.admin;

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export default function AdminLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (body: Record<string, string>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/admin/api/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        setError(
          data.error?.code === 'FORBIDDEN' ? t.notAdmin : (data.error?.message ?? res.statusText),
        );
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-extrabold">{t.title}</h1>
      <p className="text-muted">{t.signInBody}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sent) void call({ step: 'request', phone }).then(setSent);
          else
            void call({ step: 'verify', phone, code }).then((ok) => {
              if (ok) router.replace('/admin');
            });
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
      </form>
    </main>
  );
}
