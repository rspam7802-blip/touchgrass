import { AdminHostApplicationList, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { reviewAction } from './actions';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const h = resources.en.hosting;
const STATUSES = ['pending', 'approved', 'rejected'] as const;
const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** Host application queue (F-HST-01): approve to let someone sell tickets. */
export default async function HostApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  if (!(await canOpen('hostApplications'))) return <NoAccess />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? 'pending';
  const qs = new URLSearchParams({
    status,
    limit: '50',
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
  });
  const page = await adminApi(
    `/v1/admin/host-applications?${qs.toString()}`,
    AdminHostApplicationList,
    {},
    '/admin/host-applications',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.hostApplications}</h1>
      <nav aria-label={t.status} className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/host-applications?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${s === status ? 'border-primary text-primary' : 'border-border'}`}
          >
            {s}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p>{t.noApplications}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {page.items.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded-2xl border-2 border-border p-4"
              data-testid={`application-${a.applicant.displayName}`}
            >
              <h2 className="text-xl font-bold">
                {a.applicant.displayName} · {fmt.format(new Date(a.createdAt))}
              </h2>
              <dl className="grid gap-1 sm:grid-cols-[12rem_1fr]">
                <dt className="font-semibold">{h.about}</dt>
                <dd>{a.about}</dd>
                <dt className="font-semibold">{h.experience}</dt>
                <dd>{a.experience}</dd>
                <dt className="font-semibold">{h.eventIdeas}</dt>
                <dd>{a.eventIdeas}</dd>
                {a.links.length > 0 ? (
                  <>
                    <dt className="font-semibold">{h.links}</dt>
                    <dd>
                      {a.links.map((l) => (
                        <a
                          key={l}
                          href={l}
                          rel="noopener noreferrer nofollow"
                          className="block underline"
                        >
                          {l}
                        </a>
                      ))}
                    </dd>
                  </>
                ) : null}
                {a.reviewNote ? (
                  <>
                    <dt className="font-semibold">{t.note}</dt>
                    <dd>{a.reviewNote}</dd>
                  </>
                ) : null}
              </dl>
              {a.status === 'pending' ? (
                <form action={reviewAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={a.id} />
                  <label className="flex flex-col gap-1 font-semibold" htmlFor={`note-${a.id}`}>
                    {t.note}
                    <input
                      id={`note-${a.id}`}
                      name="note"
                      maxLength={500}
                      className="min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text"
                    />
                  </label>
                  <button
                    type="submit"
                    name="decision"
                    value="approved"
                    className="min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary"
                    aria-label={`${t.approve}: ${a.applicant.displayName}`}
                  >
                    {t.approve}
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="rejected"
                    className="min-h-11 rounded-full border-2 border-border px-6 font-semibold"
                    aria-label={`${t.reject}: ${a.applicant.displayName}`}
                  >
                    {t.reject}
                  </button>
                </form>
              ) : (
                <p className="font-semibold">{a.status}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/host-applications?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
