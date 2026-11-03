import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { liveView } from '../../../lib/public-api';
import { LiveClient } from './live-client';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = {
  title: `Live location · ${BRAND.name}`,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Live location viewer for trusted contacts (F-WEB-02). No login: the link is signed and expires, and once
 * sharing stops it shows nothing but that it stopped.
 */
export default async function LiveLocationPage({ params, searchParams }: Props) {
  const [{ token }, { lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const view = await liveView(token);
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 py-8">
      <span className="text-xl font-extrabold tracking-tight text-primary">{BRAND.name}</span>
      {view ? (
        <LiveClient token={token} initial={view} t={t.safety.viewer} language={language} />
      ) : (
        <h1 className="text-3xl font-extrabold" data-testid="live-not-found">
          {t.safety.viewer.notFound}
        </h1>
      )}
    </main>
  );
}
