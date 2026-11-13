'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SidebarGroup {
  title: string;
  items: { href: string; label: string }[];
}

/** The console menu: sections grouped under headings, with the current one marked. */
export function SidebarNav({ label, groups }: { label: string; groups: SidebarGroup[] }) {
  const pathname = usePathname();
  const isCurrent = (href: string): boolean =>
    href === '/admin'
      ? pathname === '/admin'
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label={label} className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-1">
          <p className="px-3 text-xs font-bold tracking-wider text-muted uppercase">{g.title}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((n) => {
              const current = isCurrent(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={current ? 'page' : undefined}
                    className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${
                      current ? 'bg-primary text-on-primary' : 'text-text hover:bg-surface-alt'
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
