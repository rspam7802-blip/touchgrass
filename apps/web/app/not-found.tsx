import { resources } from '@touchgrass/shared';
import Link from 'next/link';

export default function NotFound() {
  const t = resources.en;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-3xl font-extrabold">{t.errors.NOT_FOUND}</h1>
      <Link
        href="/"
        className="min-h-11 rounded-full bg-primary px-5 py-3 font-bold text-on-primary"
      >
        {t.brand.name}
      </Link>
    </main>
  );
}
