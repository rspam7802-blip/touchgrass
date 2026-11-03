import { MeResponse, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { navFor } from '../../../lib/admin-nav';
import { adminApi } from '../../../lib/admin-session';

const t = resources.en.admin;

export default async function AdminHome() {
  const me = await adminApi('/v1/me', MeResponse);
  const nav = (await navFor()).filter((n) => n.href !== '/admin');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.dashboard}</h1>
      <p>
        {me.displayName} · {t.roles.replace('{{roles}}', me.roles.join(', '))}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {nav.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-16 items-center rounded-2xl border-2 border-border bg-surface px-5 text-lg font-bold"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
