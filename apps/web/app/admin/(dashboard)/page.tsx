import {
  AdminHostApplicationList,
  AdminVerificationList,
  AnalyticsOverview,
  LaunchWaitlistEntry,
  MeResponse,
  ModerationQueueItem,
  paginated,
  resources,
} from '@touchgrass/shared';
import Link from 'next/link';
import type { z } from 'zod';
import { canOpen } from '../../../lib/admin-nav';
import { adminApi } from '../../../lib/admin-session';

const t = resources.en.admin;
const s = t.shell;
// The analytics API serves 7, 30 or 90 days.
const DAYS = 30;
const QUEUE_PAGE = 20;

/** A queue's size from its first page: exact when it fits, "20+" when there is more. */
async function waiting(
  open: boolean,
  path: string,
  schema: z.ZodType<{ items: unknown[]; nextCursor: string | null }>,
): Promise<string | null> {
  if (!open) return null;
  const page = await adminApi(path, schema);
  return page.nextCursor ? `${String(page.items.length)}+` : String(page.items.length);
}

/**
 * Overview (D-184): what needs someone today, how the last two weeks went, and every section this person can
 * open. Each block appears only for roles that can open its section.
 */
export default async function AdminHome() {
  const [canAnalytics, canVerify, canModerate, canHosts, canWaitlist] = await Promise.all([
    canOpen('analytics'),
    canOpen('verifications'),
    canOpen('moderation'),
    canOpen('hostApplications'),
    canOpen('waitlist'),
  ]);
  const [me, overview, verifications, reports, hosts, waitlist] = await Promise.all([
    adminApi('/v1/me', MeResponse),
    canAnalytics
      ? adminApi(`/v1/admin/analytics/overview?days=${String(DAYS)}`, AnalyticsOverview)
      : null,
    waiting(
      canVerify,
      `/v1/admin/verifications?limit=${String(QUEUE_PAGE)}`,
      AdminVerificationList,
    ),
    waiting(
      canModerate,
      `/v1/admin/moderation/queue?limit=${String(QUEUE_PAGE)}`,
      paginated(ModerationQueueItem),
    ),
    waiting(canHosts, '/v1/admin/host-applications?status=pending', AdminHostApplicationList),
    waiting(
      canWaitlist,
      `/v1/admin/waitlist?status=waiting&limit=${String(QUEUE_PAGE)}`,
      paginated(LaunchWaitlistEntry),
    ),
  ]);
  const queues = [
    { label: s.queueVerifications, count: verifications, href: '/admin/verifications' },
    { label: s.queueReports, count: reports, href: '/admin/moderation' },
    { label: s.queueHosts, count: hosts, href: '/admin/host-applications' },
    { label: s.queueWaitlist, count: waitlist, href: '/admin/waitlist' },
  ].filter((q): q is { label: string; count: string; href: string } => q.count !== null);
  const kpis = overview
    ? [
        { label: t.console.activeUsers, value: String(overview.activeUsers) },
        { label: t.console.metrics.signed_up, value: String(overview.totals.signed_up) },
        { label: t.console.metrics.pulled_up, value: String(overview.totals.pulled_up) },
        { label: t.console.metrics.checked_in, value: String(overview.totals.checked_in) },
        {
          label: t.console.showUpRate,
          value:
            overview.showUpRate === null
              ? '—'
              : `${String(Math.round(overview.showUpRate * 100))}%`,
        },
      ]
    : [];
  const peak = overview ? Math.max(1, ...overview.daily.map((d) => d.pulledUp + d.signedUp)) : 1;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1>{t.dashboard}</h1>
        <p className="text-muted">{s.welcome.replace('{{name}}', me.displayName ?? '')}</p>
        <p className="text-sm text-muted">{t.roles.replace('{{roles}}', me.roles.join(', '))}</p>
      </header>

      {queues.length > 0 ? (
        <section aria-labelledby="attention" className="flex flex-col gap-3">
          <h2 id="attention">{s.needsAttention}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="admin-queues">
            {queues.map((q) => (
              <li key={q.href}>
                <Link
                  href={q.href}
                  className={`admin-card flex h-full flex-col gap-1 hover:border-primary ${
                    q.count === '0' ? '' : 'border-primary'
                  }`}
                >
                  <span className="text-3xl font-extrabold">{q.count}</span>
                  <span className="text-sm font-semibold text-muted">{q.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview ? (
        <section aria-labelledby="pulse" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pulse">{s.lastDays.replace('{{count}}', String(DAYS))}</h2>
            <Link href="/admin/analytics" className="text-sm font-semibold underline">
              {s.allNumbers}
            </Link>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="admin-kpis">
            {kpis.map((k) => (
              <div key={k.label} className="admin-card">
                <dt className="text-sm font-semibold text-muted">{k.label}</dt>
                <dd className="text-3xl font-extrabold">{k.value}</dd>
              </div>
            ))}
          </dl>
          <figure className="admin-card flex flex-col gap-3">
            <figcaption className="flex flex-wrap gap-4 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-primary" />
                {t.console.metrics.pulled_up}
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-accent" />
                {t.console.metrics.signed_up}
              </span>
            </figcaption>
            {/* Decorative: the same numbers are in the table on the analytics page. */}
            <div aria-hidden="true" className="flex h-40 items-end gap-1" data-testid="admin-chart">
              {overview.daily.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={d.day}>
                  <div
                    className="rounded-t-sm bg-accent"
                    style={{ height: `${String((d.signedUp / peak) * 100)}%` }}
                  />
                  <div
                    className="bg-primary"
                    style={{ height: `${String((d.pulledUp / peak) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="flex justify-between text-xs text-muted">
              <span>{overview.daily[0]?.day ?? ''}</span>
              <span>{overview.daily[overview.daily.length - 1]?.day ?? ''}</span>
            </div>
          </figure>
        </section>
      ) : null}

    </>
  );
}
