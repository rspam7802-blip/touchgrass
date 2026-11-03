import {
  AdminCityList,
  ANALYTICS_METRICS,
  AnalyticsOverview,
  formatPaise,
  resources,
} from '@touchgrass/shared';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import { inputClass, labelClass, NoAccess, primaryButton } from '../../../../lib/admin-ui';

const c = resources.en.admin.console;
const PERIODS = [7, 30, 90] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ cityId?: string; days?: string }>;
}) {
  if (!(await canOpen('analytics'))) return <NoAccess />;
  const sp = await searchParams;
  const days = PERIODS.find((d) => String(d) === sp.days) ?? 7;
  const cityId = sp.cityId && /^[0-9a-f-]{36}$/.test(sp.cityId) ? sp.cityId : '';
  const qs = new URLSearchParams({ days: String(days), ...(cityId ? { cityId } : {}) });
  const [data, cities] = await Promise.all([
    adminApi(
      `/v1/admin/analytics/overview?${qs.toString()}`,
      AnalyticsOverview,
      {},
      '/admin/analytics',
    ),
    adminApi('/v1/admin/cities', AdminCityList, {}, '/admin/analytics'),
  ]);
  const peak = Math.max(1, ...data.daily.map((d) => d.pulledUp));
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.analytics}</h1>
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label={c.analytics}>
        <label className={labelClass} htmlFor="cityId">
          {c.city}
          <select id="cityId" name="cityId" defaultValue={cityId} className={inputClass}>
            <option value="">{c.allCities}</option>
            {cities.items.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="days">
          {c.days}
          <select id="days" name="days" defaultValue={String(days)} className={inputClass}>
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {c.lastDays.replace('{{count}}', String(d))}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButton}>
          {c.search}
        </button>
      </form>
      <section aria-labelledby="totals" className="flex flex-col gap-3">
        <h2 id="totals" className="text-xl font-bold">
          {c.totals}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3" data-testid="analytics-totals">
          {[
            [c.activeUsers, String(data.activeUsers)],
            [
              c.showUpRate,
              data.showUpRate === null ? '—' : `${String(Math.round(data.showUpRate * 100))}%`,
            ],
            ...ANALYTICS_METRICS.map((m) => [
              c.metrics[m],
              m === 'revenue_paise' ? formatPaise(data.totals[m]) : String(data.totals[m]),
            ]),
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border-2 border-border bg-surface p-4">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="text-2xl font-extrabold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="daily" className="flex flex-col gap-3">
        <h2 id="daily" className="text-xl font-bold">
          {c.daily}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {[
                  c.day,
                  c.metrics.signed_up,
                  c.metrics.pulled_up,
                  c.metrics.checked_in,
                  c.activeUsers,
                ].map((h) => (
                  <th key={h} scope="col" className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.day} className="border-t-2 border-border">
                  <th scope="row" className="p-2 font-semibold">
                    {d.day}
                  </th>
                  <td className="p-2">{d.signedUp}</td>
                  <td className="p-2">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 rounded bg-primary"
                        style={{ width: `${String(Math.round((d.pulledUp / peak) * 120))}px` }}
                      />
                      {d.pulledUp}
                    </span>
                  </td>
                  <td className="p-2">{d.checkedIn}</td>
                  <td className="p-2">{d.active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
