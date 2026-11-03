import { ModerationQueueItem, paginated, resources } from '@touchgrass/shared';
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
const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-[var(--tg-danger)] text-[var(--tg-on-danger)]',
  high: 'bg-accent text-on-accent',
  medium: 'bg-surface-alt text-text',
  low: 'bg-surface text-muted',
};

/** Open reports and auto-flagged content, most severe first (F-SOC-05, F-SAF-06). */
export default async function ModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  if (!(await canOpen('moderation'))) return <NoAccess />;
  const { cursor } = await searchParams;
  const qs = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
  const page = await adminApi(
    `/v1/admin/moderation/queue?${qs.toString()}`,
    paginated(ModerationQueueItem),
    {},
    '/admin/moderation',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.moderation}</h1>
      <p className="text-muted">{t.queueNote}</p>
      {page.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">
                  {t.severity}
                </th>
                <th scope="col" className="p-2">
                  {t.target}
                </th>
                <th scope="col" className="p-2">
                  {t.source}
                </th>
                <th scope="col" className="p-2">
                  {t.reports}
                </th>
                <th scope="col" className="p-2">
                  {t.category}
                </th>
                <th scope="col" className="p-2">
                  {t.when}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-border"
                  data-testid={`queue-${i.targetId}`}
                >
                  <td className="p-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-bold ${SEVERITY_STYLE[i.severity] ?? ''}`}
                    >
                      {i.severity}
                    </span>
                  </td>
                  <td className="p-2 font-mono">
                    <Link
                      href={`/admin/moderation/${i.id}`}
                      className="underline"
                      aria-label={`${t.review}: ${i.targetType} ${i.targetId}`}
                    >
                      {i.targetType}:{i.targetId}
                    </Link>
                  </td>
                  <td className="p-2">{i.source}</td>
                  <td className="p-2">{i.reportCount}</td>
                  <td className="p-2">
                    {typeof i.details.lastCategory === 'string' ? i.details.lastCategory : ''}
                  </td>
                  <td className="p-2 whitespace-nowrap">{fmt.format(new Date(i.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/moderation?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
