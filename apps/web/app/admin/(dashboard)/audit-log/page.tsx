import { AuditEntry, paginated, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  if (!(await canOpen('auditLog'))) return <NoAccess />;
  const { cursor } = await searchParams;
  const qs = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
  const page = await adminApi(
    `/v1/admin/audit-log?${qs.toString()}`,
    paginated(AuditEntry),
    {},
    '/admin/audit-log',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.auditLog}</h1>
      {page.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">
                  {t.when}
                </th>
                <th scope="col" className="p-2">
                  {t.who}
                </th>
                <th scope="col" className="p-2">
                  {t.action}
                </th>
                <th scope="col" className="p-2">
                  {t.target}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((a) => (
                <tr key={a.id} className="border-b border-border">
                  <td className="p-2 whitespace-nowrap">{fmt.format(new Date(a.createdAt))}</td>
                  <td className="p-2">{a.adminName ?? a.adminUserId}</td>
                  <td className="p-2 font-mono">{a.action}</td>
                  <td className="p-2 font-mono">
                    {a.targetType}
                    {a.targetId ? `:${a.targetId}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/audit-log?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
