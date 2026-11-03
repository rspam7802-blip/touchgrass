import { resources } from '@touchgrass/shared';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { navFor } from '../../../lib/admin-nav';
import { ACCESS_COOKIE, rolesFromToken } from '../../../lib/admin-session';

const t = resources.en.admin;

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const roles = rolesFromToken((await cookies()).get(ACCESS_COOKIE)?.value);
  // Only the sections this person's roles open (the same matrix the API enforces).
  const nav = await navFor();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6 md:flex-row">
      <nav aria-label={t.title} className="flex shrink-0 flex-col gap-2 md:w-56">
        <span className="text-xl font-extrabold text-primary">{t.title}</span>
        <span className="text-sm text-muted">{t.roles.replace('{{roles}}', roles.join(', '))}</span>
        <ul className="flex flex-col gap-1">
          {nav.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                className="flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-surface-alt"
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <form action="/admin/api/logout" method="post">
          <button
            type="submit"
            className="min-h-11 rounded-lg px-3 font-semibold text-muted underline"
          >
            {t.signOut}
          </button>
        </form>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
    </div>
  );
}
