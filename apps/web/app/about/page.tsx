import { BRAND, FOUNDERS, SUPPORTED_LANGUAGES } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { resolveLanguage, strings } from '../../lib/i18n';
import { companyDetails } from '../../lib/legal';
import { LegalFooter } from '../../lib/legal-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'About us',
  description: `${BRAND.name}: why we built it, our vision, mission and goals, and the founders.`,
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** About us (D-188): vision, mission, goals and the founders, in the visitor's language. */
export default async function AboutPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language);
  const a = t.landing.about;
  const email = companyDetails().supportEmail;
  const goals = [a.goals.launch, a.goals.safety, a.goals.free, a.goals.cities];
  return (
    <main
      lang={language}
      className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-14 px-4 py-8 sm:px-6 sm:py-10"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/?lang=${language}`}
          className="text-xl font-extrabold tracking-tight text-primary"
        >
          {BRAND.name}
        </Link>
        <nav aria-label={t.settings.language} className="flex flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map((code) => (
            <Link
              key={code}
              href={`/about?lang=${code}`}
              hrefLang={code}
              aria-current={code === language ? 'true' : undefined}
              className="min-h-11 min-w-11 rounded-full border border-border px-3 py-2 text-sm font-semibold aria-[current=true]:bg-primary aria-[current=true]:text-on-primary"
            >
              {t.settings.languageNames[code]}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-labelledby="about-title" className="flex flex-col gap-5">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.brand.tagline}
        </p>
        <h1 id="about-title" className="text-5xl font-extrabold leading-tight">
          {a.title}
        </h1>
        <p className="max-w-2xl text-lg text-muted">{a.intro}</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="vision"
          className="flex flex-col gap-3 rounded-3xl bg-primary p-6 text-on-primary"
        >
          <h2 id="vision" className="text-sm font-extrabold uppercase tracking-widest">
            {a.visionTitle}
          </h2>
          <p className="text-2xl font-bold leading-snug">{a.vision}</p>
        </section>
        <section
          aria-labelledby="mission"
          className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-6"
        >
          <h2
            id="mission"
            className="text-sm font-extrabold uppercase tracking-widest text-primary"
          >
            {a.missionTitle}
          </h2>
          <p className="text-2xl font-bold leading-snug">{a.mission}</p>
        </section>
      </div>

      <section aria-labelledby="goals" className="flex flex-col gap-5">
        <h2 id="goals" className="text-3xl font-extrabold">
          {a.goalsTitle}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2">
          {goals.map((g, i) => (
            <li key={g} className="flex gap-4 rounded-2xl border-2 border-border bg-surface p-5">
              <span
                aria-hidden="true"
                className="shrink-0 whitespace-nowrap text-2xl font-extrabold text-primary"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <p>{g}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="founders" className="flex flex-col gap-5">
        <h2 id="founders" className="text-3xl font-extrabold">
          {a.foundersTitle}
        </h2>
        <p className="max-w-2xl text-lg text-muted">{a.foundersIntro}</p>
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="founders">
          {FOUNDERS.map((f) => (
            <li
              key={f.name}
              className="flex items-center gap-4 rounded-2xl border-2 border-border bg-surface p-5"
            >
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-on-primary"
              >
                {initials(f.name)}
              </span>
              <span className="flex flex-col">
                <span className="text-xl font-bold">{f.name}</span>
                <span className="text-muted">{a.founderRole}</span>
              </span>
            </li>
          ))}
        </ul>
        {email ? (
          <p>
            {a.contact.split('{{email}}')[0]}
            <a className="font-semibold text-primary underline" href={`mailto:${email}`}>
              {email}
            </a>
          </p>
        ) : null}
      </section>

      <footer className="flex flex-col gap-3 border-t-2 border-border pt-6 text-sm text-muted">
        <Link href={`/?lang=${language}`} className="font-semibold underline">
          {a.back}
        </Link>
        <LegalFooter />
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Hyderabad
        </span>
      </footer>
    </main>
  );
}
