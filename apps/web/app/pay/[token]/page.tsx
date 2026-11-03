import { BRAND, formatPaise } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { checkoutPage, fill, formatWhen } from '../../../lib/public-api';
import { CheckoutClient } from './checkout-client';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = { title: `Checkout · ${BRAND.name}`, robots: { index: false } };

/** Checkout page opened from the app (F-PAY-01). The token is unguessable and only reads one order. */
export default async function PayPage({ params, searchParams }: Props) {
  const [{ token }, { lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const page = await checkoutPage(token);
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-8">
      <span className="text-xl font-extrabold tracking-tight text-primary">{BRAND.name}</span>
      {page ? (
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold">{page.eventTitle}</h1>
          <p>{formatWhen(page.eventStartsAt, language)}</p>
          <p className="text-2xl font-bold" data-testid="checkout-amount">
            {formatPaise(page.amountPaise, language)}
          </p>
          <p className="text-muted">{t.payments.secureCheckout}</p>
          {page.status === 'created' || page.status === 'failed' || page.status === 'captured' ? (
            <>
              {page.status !== 'captured' ? (
                <p>
                  {fill(t.payments.holdNotice, { time: formatWhen(page.holdExpiresAt, language) })}
                </p>
              ) : null}
              <CheckoutClient token={token} page={page} t={t.payments} language={language} />
            </>
          ) : (
            <p role="alert" className="font-semibold">
              {t.payments.holdExpired}
            </p>
          )}
        </section>
      ) : (
        <h1 className="text-3xl font-extrabold">{t.errors.NOT_FOUND}</h1>
      )}
    </main>
  );
}
