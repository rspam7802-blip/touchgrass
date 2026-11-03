import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppLinks } from '../../../components/AppLinks';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { APP_SCHEME, fill, publicProfile } from '../../../lib/public-api';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await publicProfile(id);
  const t = strings('en').share;
  if (!p) return { title: t.profileNotFound, robots: { index: false } };
  const title = fill(t.profileTitle, { name: p.displayName });
  return {
    title: `${title} · ${BRAND.name}`,
    description: t.profileBody,
    robots: { index: false },
    openGraph: { type: 'profile', title, description: t.profileBody },
    twitter: { card: 'summary_large_image', title, description: t.profileBody },
  };
}

/** Shared profile link (F-GRW-02): the name, badge and (for public profiles) a photo; everything else in-app. */
export default async function ProfileSharePage({ params, searchParams }: Props) {
  const [{ id }, { lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const p = await publicProfile(id);
  if (!p) notFound();
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
        {BRAND.name}
      </Link>
      <article className="flex flex-col items-start gap-4">
        {p.photo ? (
          // Signed, expiring media URLs cannot go through the Next image optimiser's static allow-list.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo.md} alt="" className="h-40 w-40 rounded-full object-cover" />
        ) : null}
        <h1 className="text-4xl font-extrabold leading-tight" data-testid="profile-share-title">
          {fill(t.share.profileTitle, { name: p.displayName })}
          {p.verified ? (
            <span className="ml-2 text-primary" aria-label={t.profile.verified}>
              ✓
            </span>
          ) : null}
        </h1>
        <p className="text-lg text-muted">{t.share.profileBody}</p>
      </article>
      <AppLinks deepLink={`${APP_SCHEME}users/${p.id}`} t={t.share} />
    </main>
  );
}
