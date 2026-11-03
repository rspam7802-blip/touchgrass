import type { PublicEventView } from '@touchgrass/shared';
import { BRAND, formatPaise } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppLinks } from '../../../components/AppLinks';
import { resolveLanguage, strings } from '../../../lib/i18n';
import { APP_SCHEME, fill, formatWhen, publicEvent } from '../../../lib/public-api';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ i?: string; lang?: string }>;
}

/** Link previews never include an address; mystery and private plans say even less (F-EVT-12/17). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const e = await publicEvent(slug);
  const t = strings('en').share;
  if (!e) return { title: t.notFoundTitle, robots: { index: false } };
  if (e.access === 'teaser') {
    const title = fill(t.privateTitle, { name: e.hostName });
    return {
      title,
      description: t.privateBody,
      robots: { index: false },
      openGraph: { title, description: t.privateBody },
    };
  }
  const area = placeLabel(e.areaName, e.cityName);
  const where = e.mystery ? fill(t.mysteryArea, { area }) : area;
  const description = `${formatWhen(e.startsAt, 'en', e.timezone)} · ${where} · ${fill(t.hostedBy, { name: e.hostName })}`;
  return {
    title: e.title,
    description,
    alternates: {
      canonical: `/e/${slug}`,
      languages: { en: `/e/${slug}?lang=en`, te: `/e/${slug}?lang=te`, hi: `/e/${slug}?lang=hi` },
    },
    openGraph: {
      type: 'website',
      title: e.title,
      description,
    },
    twitter: { card: 'summary_large_image', title: e.title, description },
  };
}

export default async function EventSharePage({ params, searchParams }: Props) {
  const [{ slug }, { i, lang }] = await Promise.all([params, searchParams]);
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const e = await publicEvent(slug);
  if (!e) notFound();
  const invite = i && /^[A-Za-z0-9_-]{10,100}$/.test(i) ? `?i=${i}` : '';
  const deepLink = `${APP_SCHEME}e/${slug}${invite}`;

  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
        {BRAND.name}
      </Link>
      {e.access === 'teaser' ? (
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold">
            {fill(t.share.privateTitle, { name: e.hostName })}
          </h1>
          <p className="text-lg text-muted">{t.share.privateBody}</p>
          <p>
            <span className="font-semibold">{t.share.when}: </span>
            {formatWhen(e.startsAt, language, e.timezone)}
          </p>
        </section>
      ) : (
        <article className="flex flex-col gap-5">
          {e.cover ? (
            // Signed, expiring media URLs cannot go through the Next image optimiser's static allow-list.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={e.cover.md}
              alt=""
              className="aspect-square w-full rounded-2xl object-cover"
            />
          ) : null}
          {e.type === 'curated' ? (
            <p className="self-start rounded-full bg-primary px-3 py-1 font-bold text-on-primary">
              {t.share.curated}
            </p>
          ) : null}
          <h1 className="text-4xl font-extrabold leading-tight">{e.title}</h1>
          {e.status === 'cancelled' ? (
            <p role="status" className="rounded-xl border-2 border-border px-4 py-3 font-bold">
              {t.share.cancelled}
            </p>
          ) : e.status === 'completed' ? (
            <p role="status" className="rounded-xl border-2 border-border px-4 py-3 font-bold">
              {t.share.ended}
            </p>
          ) : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-lg [overflow-wrap:anywhere]">
            <dt className="font-semibold">{t.share.when}</dt>
            <dd>{formatWhen(e.startsAt, language, e.timezone)}</dd>
            <dt className="font-semibold">{t.share.where}</dt>
            <dd>
              {e.mystery
                ? fill(t.share.mysteryArea, { area: placeLabel(e.areaName, e.cityName) })
                : placeLabel(e.areaName, e.cityName)}
              {e.mystery ? (
                <span className="block text-base text-muted">{t.share.mysteryNote}</span>
              ) : null}
            </dd>
          </dl>
          <p className="text-lg">{fill(t.share.hostedBy, { name: e.hostName })}</p>
          <ul className="flex flex-wrap gap-2 font-semibold">
            <li className="rounded-full border-2 border-border px-3 py-1">
              {fill(t.share.going, { count: e.goingCount })}
            </li>
            <li className="rounded-full border-2 border-border px-3 py-1">
              {fill(t.share.spotsLeft, { count: e.spotsLeft })}
            </li>
            <li className="rounded-full border-2 border-border px-3 py-1">
              {e.pricePaise === 0 ? t.share.free : formatPaise(e.pricePaise, language)}
            </li>
          </ul>
          {e.description ? <p className="whitespace-pre-line text-muted">{e.description}</p> : null}
          <script
            type="application/ld+json"
            // Structured data for search: area only, never an address (mystery-safe, F-EVT-12).
            dangerouslySetInnerHTML={{ __html: eventJsonLd(e, slug) }}
          />
        </article>
      )}
      <AppLinks deepLink={deepLink} t={t.share} />
    </main>
  );
}

/** "Gachibowli, Hyderabad"; just the city (or Hyderabad) when there is no area. */
function placeLabel(area: string | null, city: string | null): string {
  const c = city ?? 'Hyderabad';
  return area ? `${area}, ${c}` : c;
}

const STATUS_LD = {
  published: 'https://schema.org/EventScheduled',
  draft: 'https://schema.org/EventScheduled',
  completed: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
} as const;

/** schema.org Event (no address, no attendees); `<` is escaped so it can't close the script tag. */
function eventJsonLd(e: Extract<PublicEventView, { access: 'full' }>, slug: string): string {
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description: e.description || undefined,
    startDate: e.startsAt,
    endDate: e.endsAt,
    eventStatus: STATUS_LD[e.status],
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: placeLabel(e.areaName, e.cityName),
      address: {
        '@type': 'PostalAddress',
        addressLocality: e.cityName ?? 'Hyderabad',
        addressCountry: 'IN',
      },
    },
    organizer: { '@type': 'Person', name: e.hostName },
    isAccessibleForFree: e.pricePaise === 0,
    offers: {
      '@type': 'Offer',
      price: (e.pricePaise / 100).toFixed(2),
      priceCurrency: 'INR',
      availability: e.spotsLeft > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url: `/e/${slug}`,
    },
    image: e.cover ? [e.cover.lg] : undefined,
  };
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}
