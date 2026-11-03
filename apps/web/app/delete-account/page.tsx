import { BRAND, LIMITS } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { resolveLanguage, strings } from '../../lib/i18n';
import { fill } from '../../lib/public-api';

interface Props {
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = {
  title: `${strings('en').deleteAccount.title} · ${BRAND.name}`,
  description: strings('en').deleteAccount.intro,
};

/** Account deletion instructions (store requirement): the in-app steps and what happens to the data. */
export default async function DeleteAccountPage({ searchParams }: Props) {
  const { lang } = await searchParams;
  const language = resolveLanguage(lang, (await headers()).get('accept-language'));
  const t = strings(language).deleteAccount;
  const days = LIMITS.account.deletionGraceDays;
  // Read per request (the page is dynamic), so one build serves every environment.
  const email = process.env.SUPPORT_EMAIL;
  const [before, after] = t.noApp.split('{{email}}');
  return (
    <main lang={language} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
        {BRAND.name}
      </Link>
      <article className="flex flex-col gap-6">
        <h1 className="text-3xl font-extrabold leading-tight">{t.title}</h1>
        <p className="text-lg">{t.intro}</p>
        <section aria-labelledby="delete-steps" className="flex flex-col gap-3">
          <h2 id="delete-steps" className="text-xl font-bold">
            {t.stepsTitle}
          </h2>
          <ol className="list-decimal space-y-2 pl-6">
            <li>{t.step1}</li>
            <li>{t.step2}</li>
            <li>{t.step3}</li>
          </ol>
        </section>
        <section aria-labelledby="delete-next" className="flex flex-col gap-3">
          <h2 id="delete-next" className="text-xl font-bold">
            {t.happensTitle}
          </h2>
          <p>{fill(t.immediate, { days })}</p>
          <p>{fill(t.purge, { days })}</p>
          <p className="text-muted">{t.kept}</p>
        </section>
        {email ? (
          <p data-testid="delete-no-app">
            {before}
            <a className="font-semibold text-primary underline" href={`mailto:${email}`}>
              {email}
            </a>
            {after}
          </p>
        ) : null}
      </article>
    </main>
  );
}
