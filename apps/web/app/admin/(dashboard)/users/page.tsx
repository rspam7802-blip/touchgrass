import { AdminUserList, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** Find people by name, phone number or ID (F-WEB-03), to see their standing and act on it. */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!(await canOpen('users'))) return <NoAccess />;
  const q = ((await searchParams).q ?? '').trim();
  const list =
    q.length >= 2
      ? await adminApi(
          `/v1/admin/users?q=${encodeURIComponent(q)}`,
          AdminUserList,
          {},
          `/admin/users?q=${encodeURIComponent(q)}`,
        )
      : null;
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.users}</h1>
      <form role="search" className="flex flex-wrap items-end gap-3">
        <label htmlFor="user-search" className="font-semibold">
          {t.searchUsers}
        </label>
        <input
          id="user-search"
          name="q"
          defaultValue={q}
          minLength={2}
          maxLength={100}
          required
          className="min-h-11 flex-1 rounded-xl border-2 border-input bg-surface px-3 text-text"
        />
        <button
          type="submit"
          className="min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary"
        >
          {t.search}
        </button>
      </form>
      {list && list.items.length === 0 ? <p>{t.empty}</p> : null}
      {list && list.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">
                  {t.who}
                </th>
                <th scope="col" className="p-2">
                  {t.phone}
                </th>
                <th scope="col" className="p-2">
                  {t.status}
                </th>
                <th scope="col" className="p-2">
                  {t.verifiedCol}
                </th>
                <th scope="col" className="p-2">
                  {t.joined}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((u) => (
                <tr key={u.id} className="border-b border-border" data-testid={`user-${u.id}`}>
                  <td className="p-2">
                    <Link href={`/admin/users/${u.id}`} className="font-semibold underline">
                      {u.displayName ?? u.id}
                    </Link>
                  </td>
                  <td className="p-2">
                    {u.phoneLast4 ? t.phoneEnding.replace('{{last4}}', u.phoneLast4) : ''}
                  </td>
                  <td className="p-2">{t.userStatuses[u.status]}</td>
                  <td className="p-2">{u.verified ? '✓' : ''}</td>
                  <td className="p-2 whitespace-nowrap">{fmt.format(new Date(u.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
