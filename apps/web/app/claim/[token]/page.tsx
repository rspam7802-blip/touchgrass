import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { AppLinks } from '../../../components/AppLinks';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { APP_SCHEME, fill, formatWhen, plusOnePreview } from '../../../lib/public-api';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = { robots: { index: false } };

/** Guest +1 claim landing (F-EVT-07): the friend installs the app and signs up with this link. */
export default async function ClaimPage({ params, searchParams }: Props) {
  const [{ token }, { lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language).share;
  const preview = await plusOnePreview(token);
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
        {BRAND.name}
      </Link>
      {preview ? (
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold">
            {fill(t.claimTitle, { name: preview.inviterName })}
          </h1>
          {preview.event.access === 'full' ? (
            <>
              <p className="text-lg">{fill(t.claimBody, { title: preview.event.title })}</p>
              <p>
                <span className="font-semibold">{t.when}: </span>
                {formatWhen(preview.event.startsAt, language)}
              </p>
            </>
          ) : null}
          <AppLinks deepLink={`${APP_SCHEME}claim/${token}`} t={t} />
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold">{t.claimGone}</h1>
        </section>
      )}
    </main>
  );
}
