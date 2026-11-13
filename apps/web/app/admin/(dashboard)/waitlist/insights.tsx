import { resources, type WaitlistInsights } from '@touchgrass/shared';
import Link from 'next/link';

const t = resources.en.admin.waitlist.insights;
const PERIODS = [7, 30, 90] as const;

function Breakdown({
  title,
  rows,
  label = (k: string) => k,
  testId,
}: {
  title: string;
  rows: { key: string; count: number }[];
  label?: (key: string) => string;
  testId: string;
}) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="admin-card flex flex-col gap-3" aria-label={title} data-testid={testId}>
      <h3 className="font-bold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">{t.none}</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.slice(0, 8).map((r) => (
          <li key={r.key} className="flex flex-col gap-1">
            <span className="flex justify-between gap-2 text-sm">
              <span className="font-semibold">{label(r.key)}</span>
              <span>{r.count}</span>
            </span>
            <span aria-hidden="true" className="h-2 rounded-full bg-surface-alt">
              <span
                className="block h-2 rounded-full bg-primary"
                style={{ width: `${String(Math.round((r.count / top) * 100))}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Waitlist insights (D-191): how many, from where, through whom, and how far they got. */
export function WaitlistInsightsPanel({
  data,
  status,
}: {
  data: WaitlistInsights;
  status: string;
}) {
  const peak = Math.max(1, ...data.daily.map((d) => Math.max(d.signedUp, d.invited)));
  const f = data.funnel;
  const pct = (n: number): string =>
    f.signedUp === 0 ? '—' : `${String(Math.round((n / f.signedUp) * 100))}%`;
  const sourceName = (k: string): string =>
    (t.sources as Record<string, string | undefined>)[k] ?? k;
  return (
    <section aria-labelledby="waitlist-insights" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="waitlist-insights">{t.title}</h2>
        <nav aria-label={t.period} className="flex flex-wrap gap-2">
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={`/admin/waitlist?status=${status}&days=${String(d)}`}
              aria-current={d === data.days ? 'true' : undefined}
              className="min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold aria-[current=true]:bg-primary aria-[current=true]:text-on-primary"
            >
              {t.lastDays.replace('{{count}}', String(d))}
            </Link>
          ))}
          <a
            href={`/admin/waitlist/export?status=${status}`}
            className="min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold"
            data-testid="waitlist-export"
          >
            {t.export}
          </a>
        </nav>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="waitlist-totals">
        {[
          [t.inPeriod.replace('{{count}}', String(data.days)), data.totals.inPeriod],
          [t.today, data.totals.today],
          [t.last7, data.totals.last7Days],
          [t.waitingNow, data.totals.waiting],
          [t.allTime, data.totals.allTime],
        ].map(([label, value]) => (
          <div key={String(label)} className="admin-card">
            <dt className="text-sm font-semibold text-muted">{label}</dt>
            <dd className="text-3xl font-extrabold">{value}</dd>
          </div>
        ))}
      </dl>
      <figure className="admin-card flex flex-col gap-3">
        <figcaption className="flex flex-wrap gap-4 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-primary" />
            {t.signedUp}
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-accent" />
            {t.invited}
          </span>
        </figcaption>
        <div
          aria-hidden="true"
          className="flex h-36 items-end gap-0.5"
          data-testid="waitlist-chart"
        >
          {data.daily.map((d) => (
            <div
              key={d.day}
              className="flex h-full flex-1 items-end gap-px"
              title={`${d.day}: ${String(d.signedUp)} / ${String(d.invited)}`}
            >
              <div
                className="flex-1 rounded-t-sm bg-primary"
                style={{ height: `${String((d.signedUp / peak) * 100)}%` }}
              />
              <div
                className="flex-1 rounded-t-sm bg-accent"
                style={{ height: `${String((d.invited / peak) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="flex justify-between text-xs text-muted">
          <span>{data.daily[0]?.day ?? ''}</span>
          <span>{data.daily[data.daily.length - 1]?.day ?? ''}</span>
        </div>
        {/* The same numbers for screen readers. */}
        <table className="sr-only">
          <caption>{t.dailyTable}</caption>
          <thead>
            <tr>
              <th scope="col">{t.day}</th>
              <th scope="col">{t.signedUp}</th>
              <th scope="col">{t.invited}</th>
            </tr>
          </thead>
          <tbody>
            {data.daily.map((d) => (
              <tr key={d.day}>
                <th scope="row">{d.day}</th>
                <td>{d.signedUp}</td>
                <td>{d.invited}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
      <section
        className="admin-card flex flex-col gap-3"
        aria-label={t.funnel}
        data-testid="waitlist-funnel"
      >
        <h3 className="font-bold">{t.funnel}</h3>
        <ol className="grid gap-3 sm:grid-cols-4">
          {[
            [t.signedUp, f.signedUp],
            [t.invited, f.invited],
            [t.joinedApp, f.joinedApp],
            [t.finishedProfile, f.finishedProfile],
          ].map(([label, n], i) => (
            <li key={String(label)} className="flex flex-col">
              <span className="text-sm font-semibold text-muted">
                {String(i + 1)}. {label}
              </span>
              <span className="text-2xl font-extrabold">{n}</span>
              <span className="text-sm text-muted">{i === 0 ? '' : pct(Number(n))}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown
          title={t.bySource}
          rows={data.bySource}
          label={sourceName}
          testId="waitlist-sources"
        />
        <Breakdown
          title={t.byReferrer}
          rows={data.byReferrer.map((r) => ({ key: r.name, count: r.count }))}
          testId="waitlist-referrers"
        />
        <Breakdown title={t.byCity} rows={data.byCity} testId="waitlist-cities" />
        <Breakdown
          title={t.byLanguage}
          rows={data.byLanguage}
          label={(k) => (resources.en.settings.languageNames as Record<string, string>)[k] ?? k}
          testId="waitlist-languages"
        />
        <Breakdown
          title={t.byContact}
          rows={data.byContact}
          label={(k) => (t.contacts as Record<string, string | undefined>)[k] ?? k}
          testId="waitlist-contacts"
        />
      </div>
    </section>
  );
}
