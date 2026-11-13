import { BRAND, resources } from '@touchgrass/shared';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SidebarNav } from '../../../components/admin/SidebarNav';
import { ADMIN_NAV_GROUPS, navFor } from '../../../lib/admin-nav';
import { ACCESS_COOKIE, rolesFromToken } from '../../../lib/admin-session';

const t = resources.en.admin;

/**
 * The console shell (D-184): a sidebar with the sections this person's roles open (the same matrix the API
 * enforces), grouped under headings, and the page beside it. On a phone the menu folds away under a button.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const roles = rolesFromToken((await cookies()).get(ACCESS_COOKIE)?.value);
  const nav = await navFor();
  const groups = ADMIN_NAV_GROUPS.map((g) => ({
    title: t.shell.groups[g],
    items: nav.filter((n) => n.group === g).map(({ href, label }) => ({ href, label })),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="admin flex min-h-dvh flex-col md:flex-row">
      <aside className="shrink-0 border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-64 md:overflow-y-auto md:border-r md:border-b-0">
        <details className="group md:hidden">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between px-4 font-extrabold">
            <span>
              {BRAND.name} <span className="text-primary">{t.title}</span>
            </span>
            <span className="rounded-lg border border-border px-3 py-1 text-sm font-semibold">
              {t.shell.menu}
            </span>
          </summary>
          <div className="flex flex-col gap-5 px-3 pb-5">
            <SidebarNav label={t.title} groups={groups} />
            <SignOut roles={roles} showRoles={false} />
          </div>
        </details>
        <div className="hidden h-full flex-col gap-5 p-4 md:flex">
          <Link href="/admin" className="flex flex-col px-3 pt-2">
            <span className="text-lg font-extrabold">{BRAND.name}</span>
            <span className="text-sm font-bold text-primary">{t.title}</span>
          </Link>
          <DesktopNav groups={groups} />
          <div className="mt-auto">
            <SignOut roles={roles} />
          </div>
        </div>
      </aside>
      <main className="admin-main flex min-w-0 flex-1 flex-col gap-6 px-5 py-6 md:px-10 md:py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}

/** The one menu on wide screens; phones use the copy inside the folding panel (hidden there on desktop). */
function DesktopNav({
  groups,
}: {
  groups: { title: string; items: { href: string; label: string }[] }[];
}) {
  return <SidebarNav label={t.title} groups={groups} />;
}

function SignOut({ roles, showRoles = true }: { roles: string[]; showRoles?: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 pt-4">
      {showRoles ? (
        <span className="text-xs text-muted">{t.roles.replace('{{roles}}', roles.join(', '))}</span>
      ) : null}
      <form action="/admin/api/logout" method="post">
        <button
          type="submit"
          className="min-h-11 w-full rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-alt"
        >
          {t.signOut}
        </button>
      </form>
    </div>
  );
}
