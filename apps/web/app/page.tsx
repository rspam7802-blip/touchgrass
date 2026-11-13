import { BRAND, isReferralCode, SUPPORTED_LANGUAGES } from '@touchgrass/shared';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { resolveLanguage, strings } from '../lib/i18n';
import { LegalFooter } from '../lib/legal-page';
import { InviteCheck } from './_landing/invite-check';
import { StoreLinks } from './_landing/store-links';
import { WaitlistForm } from './_landing/waitlist-form';

interface PageProps {
  searchParams: Promise<{ lang?: string; ref?: string }>;
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-5">
      <h2 id={`${id}-title`} className="text-3xl font-extrabold leading-tight">
        {title}
      </h2>
      {intro ? <p className="max-w-2xl text-lg text-muted">{intro}</p> : null}
      {children}
    </section>
  );
}

function Card({ title, body, step }: { title: string; body: string; step?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-5">
      {step ? (
        <span aria-hidden="true" className="text-sm font-extrabold text-primary">
          {String(step).padStart(2, '0')}
        </span>
      ) : null}
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="text-muted">{body}</p>
    </div>
  );
}

/** Public home page (D-169): what TouchGrass is, how it works, safety, invite check and the waitlist. */
export default async function Home({ searchParams }: PageProps) {
  const { lang, ref } = await searchParams;
  // A friend's referral link (F-GRW-01): show their code to enter at sign-up; anything else is ignored.
  const referral = ref && isReferralCode(ref) ? ref.trim().toUpperCase() : null;
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const l = t.landing;
  const playUrl = process.env.NEXT_PUBLIC_PLAY_STORE_URL || null;
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL || null;
  const errors = { RATE_LIMITED: t.errors.RATE_LIMITED, INTERNAL: t.errors.INTERNAL };
  const steps = [l.how.find, l.how.pullUp, l.how.meet, l.how.lore];
  const features = [l.features.plans, l.features.crews, l.features.squad, l.features.chat];
  const safety = [
    l.safety.adults,
    l.safety.selfie,
    l.safety.reliability,
    l.safety.report,
    l.safety.sos,
    l.safety.mystery,
  ];
  const faq = [
    [l.faq.whoQ, l.faq.whoA],
    [l.faq.costQ, l.faq.costA],
    [l.faq.cityQ, l.faq.cityA],
    [l.faq.phoneQ, l.faq.phoneA],
    [l.faq.mysteryQ, l.faq.mysteryA],
  ] as const;

  return (
    <main
      lang={language}
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-16 px-4 py-8 sm:px-6 sm:py-10"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xl font-extrabold tracking-tight text-primary">{BRAND.name}</span>
        <Link
          href={`/about?lang=${language}`}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold underline"
        >
          {l.about.nav}
        </Link>
        <nav aria-label={t.settings.language} className="flex flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map((code) => (
            <Link
              key={code}
              href={`/?lang=${code}${referral ? `&ref=${referral}` : ''}`}
              hrefLang={code}
              aria-current={code === language ? 'true' : undefined}
              className="min-h-11 min-w-11 rounded-full border border-border px-3 py-2 text-sm font-semibold aria-[current=true]:bg-primary aria-[current=true]:text-on-primary"
            >
              {t.settings.languageNames[code]}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-labelledby="hero-title" className="flex flex-col gap-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.brand.subtitle}
        </p>
        <h1 id="hero-title" className="text-5xl font-extrabold leading-tight sm:text-6xl">
          {t.brand.tagline}
        </h1>
        <p className="text-2xl font-bold">{t.welcome.headline}</p>
        <p className="max-w-2xl text-lg text-muted">{l.heroBody}</p>
        {referral ? (
          <p
            className="rounded-2xl border-2 border-primary p-4 text-lg font-semibold"
            data-testid="referral-code"
          >
            {t.referrals.landingCode.replace('{{code}}', referral)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <a
            href="#invite"
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-6 py-3 font-bold text-on-primary"
          >
            {l.checkCta}
          </a>
          <a
            href="#waitlist"
            className="inline-flex min-h-11 items-center rounded-full border-2 border-border px-6 py-3 font-bold"
          >
            {l.waitlistCta}
          </a>
        </div>
        <StoreLinks playUrl={playUrl} appStoreUrl={appStoreUrl} />
      </section>

      <Section id="how" title={l.howTitle}>
        <ol className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex [&>div]:grow">
              <Card title={s.title} body={s.body} step={i + 1} />
            </li>
          ))}
        </ol>
      </Section>

      <Section id="features" title={l.featuresTitle}>
        <ul className="grid list-none gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f.title} className="flex [&>div]:grow">
              <Card title={f.title} body={f.body} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="safety" title={l.safetyTitle} intro={l.safetyIntro}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {safety.map((item) => (
            <li key={item} className="flex gap-3 rounded-2xl border-2 border-border p-4">
              <span aria-hidden="true" className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="invite-only" title={l.inviteTitle}>
        <p className="max-w-2xl text-lg">{l.inviteBody}</p>
        <p className="max-w-2xl text-lg text-muted">{l.inviteCities}</p>
      </Section>

      <div className="grid gap-12 lg:grid-cols-2">
        <Section id="invite" title={l.check.title} intro={l.check.body}>
          <InviteCheck t={l.check} errors={errors} playUrl={playUrl} appStoreUrl={appStoreUrl} />
        </Section>
        <Section id="waitlist" title={l.waitlist.title} intro={l.waitlist.body}>
          <WaitlistForm t={l.waitlist} errors={errors} language={language} />
        </Section>
      </div>

      <Section id="faq" title={l.faqTitle}>
        <div className="flex flex-col gap-3">
          {faq.map(([q, a]) => (
            <details key={q} className="rounded-2xl border-2 border-border px-4">
              <summary className="flex min-h-11 cursor-pointer items-center py-2 text-lg font-bold">
                {q}
              </summary>
              <p className="pb-4 text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      <footer className="flex flex-col gap-3 border-t-2 border-border pt-6 text-sm text-muted">
        <LegalFooter />
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Hyderabad
        </span>
      </footer>
    </main>
  );
}
