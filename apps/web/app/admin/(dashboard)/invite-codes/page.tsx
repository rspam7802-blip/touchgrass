import { InviteCode, paginated, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { revokeAction } from './actions';
import { BulkForm } from './bulk-form';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

export default async function InviteCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  if (!(await canOpen('inviteCodes'))) return <NoAccess />;
  const { cursor } = await searchParams;
  const qs = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
  const page = await adminApi(
    `/v1/admin/invite-codes?${qs.toString()}`,
    paginated(InviteCode),
    {},
    '/admin/invite-codes',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.inviteCodes}</h1>
      <BulkForm />
      {page.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">
                  {t.code_col}
                </th>
                <th scope="col" className="p-2">
                  {t.uses}
                </th>
                <th scope="col" className="p-2">
                  {t.expires}
                </th>
                <th scope="col" className="p-2">
                  {t.label}
                </th>
                <th scope="col" className="p-2">
                  {t.status}
                </th>
                <th scope="col" className="p-2">
                  <span className="sr-only">{t.revoke}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-border"
                  data-testid={`invite-row-${i.code}`}
                >
                  <td className="p-2 font-mono">{i.code}</td>
                  <td className="p-2">
                    {i.uses}/{i.maxUses}
                  </td>
                  <td className="p-2">
                    {i.expiresAt ? fmt.format(new Date(i.expiresAt)) : t.never}
                  </td>
                  <td className="p-2">{i.label ?? ''}</td>
                  <td className="p-2">{i.revoked ? t.revoked : t.active}</td>
                  <td className="p-2">
                    {!i.revoked ? (
                      <form action={revokeAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <button
                          type="submit"
                          className="min-h-11 rounded-full border-2 border-border px-4 font-semibold"
                          aria-label={`${t.revoke} ${i.code}`}
                        >
                          {t.revoke}
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/invite-codes?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
