import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { fill, formatWhen, perkPreview } from '../../../lib/public-api';
import { RedeemForm } from './redeem-form';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = { title: `Perk · ${BRAND.name}`, robots: { index: false } };

/** What venue staff see after scanning a perk QR (F-PAY-04): first name, group size, then the PIN. */
export default async function PerkPassPage({ params, searchParams }: Props) {
  const [{ token }, { lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const pass = await perkPreview(token);
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-8">
      <span className="text-xl font-extrabold tracking-tight text-primary">{BRAND.name}</span>
      {pass ? (
        <section className="flex flex-col gap-4">
          <p className="text-muted">{t.perks.staffTitle}</p>
          <h1 className="text-3xl font-extrabold">{pass.perkTitle}</h1>
          {pass.perkDescription ? <p>{pass.perkDescription}</p> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 [overflow-wrap:anywhere]">
            <dt className="font-semibold">{t.share.when}</dt>
            <dd>{pass.eventTitle}</dd>
            <dt className="font-semibold">{pass.venueName}</dt>
            <dd>
              {pass.firstName} · {fill(t.perks.groupOf, { count: pass.groupSize })}
            </dd>
          </dl>
          {pass.redeemedAt ? (
            <p role="status" className="text-xl font-bold" data-testid="perk-already">
              {fill(t.perks.redeemed, { time: formatWhen(pass.redeemedAt, language) })}
            </p>
          ) : (
            <RedeemForm token={token} t={t} />
          )}
        </section>
      ) : (
        <h1 className="text-3xl font-extrabold">{t.errors.NOT_FOUND}</h1>
      )}
    </main>
  );
}
