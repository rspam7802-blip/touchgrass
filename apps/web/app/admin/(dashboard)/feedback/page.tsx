import { AdminFeedbackList, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const a = resources.en.after;
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
const th = 'p-2 text-left';
const stars = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)} ★`);
const improveLabel = (tag: string): string =>
  tag in a.improve ? a.improve[tag as keyof typeof a.improve] : tag;

/**
 * Feedback across plans (F-AFT-02): response counts, averages and the most common "could be better" tags,
 * newest first or lowest rated first so curators can follow up with hosts. Comments stay with the hosts.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; sort?: string }>;
}) {
  if (!(await canOpen('feedback'))) return <NoAccess />;
  const { cursor, sort: rawSort } = await searchParams;
  const sort = rawSort === 'lowest' ? 'lowest' : 'recent';
  const qs = new URLSearchParams({ limit: '50', sort, ...(cursor ? { cursor } : {}) });
  const page = await adminApi(
    `/v1/admin/feedback?${qs.toString()}`,
    AdminFeedbackList,
    {},
    '/admin/feedback',
  );
  const sorts = [
    { id: 'recent', label: t.sortRecent },
    { id: 'lowest', label: t.sortLowest },
  ] as const;
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.feedback}</h1>
      <nav aria-label={t.feedback} className="flex flex-wrap gap-2">
        {sorts.map((s) => (
          <Link
            key={s.id}
            href={`/admin/feedback?sort=${s.id}`}
            aria-current={sort === s.id ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${
              sort === s.id ? 'border-primary bg-primary text-on-primary' : 'border-border'
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="feedback-table">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className={th}>
                  {t.event}
                </th>
                <th scope="col" className={th}>
                  {t.host}
                </th>
                <th scope="col" className={th}>
                  {t.responses}
                </th>
                <th scope="col" className={th}>
                  {t.rating}
                </th>
                <th scope="col" className={th}>
                  {t.hostRatingCol}
                </th>
                <th scope="col" className={th}>
                  {t.needsWork}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((r) => (
                <tr key={r.eventId} className="border-b border-border">
                  <td className="p-2">
                    <span className="font-semibold">{r.eventTitle}</span>
                    <br />
                    <span className="text-sm text-muted">{fmt.format(new Date(r.startsAt))}</span>
                  </td>
                  <td className="p-2">{r.host.displayName}</td>
                  <td className="p-2">{r.count}</td>
                  <td className="p-2">{stars(r.averageRating)}</td>
                  <td className="p-2">{stars(r.hostAverage)}</td>
                  <td className="p-2">
                    {r.topImprove.length === 0
                      ? '—'
                      : r.topImprove.map((x) => `${improveLabel(x.tag)} (${x.count})`).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/feedback?sort=${sort}&cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
