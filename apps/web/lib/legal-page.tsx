import { BRAND } from '@touchgrass/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LegalDocument } from './legal';

/** Shared layout for the legal pages: plain, readable, in English (the binding version). */
export function LegalPage({ doc, children }: { doc: LegalDocument; children?: ReactNode }) {
  return (
    <main lang="en" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-8">
      <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
        {BRAND.name}
      </Link>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold leading-tight">{doc.title}</h1>
          <p className="text-sm text-muted">Last updated {doc.updated}</p>
        </header>
        <p className="text-lg">{doc.intro}</p>
        {doc.sections.map((s, i) => (
          <section
            key={s.heading}
            aria-labelledby={`legal-${String(i)}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`legal-${String(i)}`} className="text-xl font-bold">
              {s.heading}
            </h2>
            {s.paragraphs.length > 1 ? (
              <ul className="list-disc space-y-2 pl-6">
                {s.paragraphs.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p>{s.paragraphs[0]}</p>
            )}
          </section>
        ))}
        {children}
      </article>
      <LegalFooter />
    </main>
  );
}

export function LegalFooter() {
  const links = [
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' },
    { href: '/refunds', label: 'Refunds' },
    { href: '/contact', label: 'Contact' },
    { href: '/delete-account', label: 'Delete account' },
  ];
  return (
    <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-muted underline hover:text-primary">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
