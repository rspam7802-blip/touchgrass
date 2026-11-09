import { BRAND, isReferralCode, SUPPORTED_LANGUAGES } from '@touchgrass/shared';
import { headers } from 'next/headers';
import Link from 'next/link';
import { resolveLanguage, strings } from '../lib/i18n';
import { LegalFooter } from '../lib/legal-page';

interface PageProps {
  searchParams: Promise<{ lang?: string; ref?: string }>;
}

export default async function Home({ searchParams }: PageProps) {
  const { lang, ref } = await searchParams;
  // A friend's referral link (F-GRW-01): show their code to enter at sign-up; anything else is ignored.
  const referral = ref && isReferralCode(ref) ? ref.trim().toUpperCase() : null;
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const playUrl = process.env.NEXT_PUBLIC_PLAY_STORE_URL;
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL;

  return (
    <main
      lang={language}
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-between gap-12 px-6 py-10"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xl font-extrabold tracking-tight text-primary">{BRAND.name}</span>
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

      <section className="flex flex-col gap-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.brand.subtitle}
        </p>
        <h1 className="text-5xl font-extrabold leading-tight sm:text-6xl">{t.brand.tagline}</h1>
        <p className="text-2xl font-bold">{t.welcome.headline}</p>
        <p className="max-w-xl text-lg text-muted">{t.welcome.body}</p>
        {referral ? (
          <p
            className="rounded-2xl border-2 border-primary p-4 text-lg font-semibold"
            data-testid="referral-code"
          >
            {t.referrals.landingCode.replace('{{code}}', referral)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {playUrl ? (
            <a
              href={playUrl}
              className="min-h-11 rounded-full bg-primary px-6 py-3 font-bold text-on-primary"
            >
              Google Play
            </a>
          ) : null}
          {appStoreUrl ? (
            <a
              href={appStoreUrl}
              className="min-h-11 rounded-full bg-accent px-6 py-3 font-bold text-on-accent"
            >
              App Store
            </a>
          ) : null}
        </div>
      </section>

      <footer className="flex flex-col gap-3 text-sm text-muted">
        <LegalFooter />
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Hyderabad
        </span>
      </footer>
    </main>
  );
}
