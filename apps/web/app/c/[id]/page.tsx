import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppLinks } from '../../../components/AppLinks';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { APP_SCHEME, fill, publicCrew } from '../../../lib/public-api';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await publicCrew(id);
  const t = strings('en').share;
  if (!c) return { title: t.crewNotFound, robots: { index: false } };
  const title = fill(t.crewTitle, { name: c.name });
  const description = `${fill(t.crewMembers, { count: c.memberCount })} · ${c.description || t.crewBody}`;
  return {
    title: `${title} · ${BRAND.name}`,
    description,
    openGraph: { type: 'website', title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/** Shared crew link (F-GRW-02): open crews only; joining happens in the app. */
export default async function CrewSharePage({ params, searchParams }: Props) {
  const [{ id }, { lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const c = await publicCrew(id);
  if (!c) notFound();
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
        {BRAND.name}
      </Link>
      <article className="flex flex-col gap-4">
        {c.cover ? (
          // Signed, expiring media URLs cannot go through the Next image optimiser's static allow-list.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.cover.md} alt="" className="aspect-video w-full rounded-2xl object-cover" />
        ) : null}
        <h1 className="text-4xl font-extrabold leading-tight">{c.name}</h1>
        <p className="font-semibold" data-testid="crew-share-members">
          {fill(t.share.crewMembers, { count: c.memberCount })}
        </p>
        {c.description ? <p className="whitespace-pre-line">{c.description}</p> : null}
        <p className="text-lg text-muted">{t.share.crewBody}</p>
      </article>
      <AppLinks deepLink={`${APP_SCHEME}crews/${c.id}`} t={t.share} />
    </main>
  );
}
