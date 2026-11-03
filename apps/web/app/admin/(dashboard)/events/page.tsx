import {
  AdminEventPage,
  AdminEventQuery,
  AdminCityList,
  EventStatus,
  EventType,
  resources,
} from '@touchgrass/shared';
import Link from 'next/link';
import { canOpen } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import {
  inputClass,
  istDateTime,
  labelClass,
  NoAccess,
  primaryButton,
} from '../../../../lib/admin-ui';

const t = resources.en.admin;
const c = t.console;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!(await canOpen('events'))) return <NoAccess />;
  const raw = await searchParams;
  const q = AdminEventQuery.parse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== '')),
  );
  const qs = new URLSearchParams(
    Object.entries({ ...q, featured: q.featured === undefined ? undefined : String(q.featured) })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  const [page, cities] = await Promise.all([
    adminApi(`/v1/admin/events?${qs.toString()}`, AdminEventPage, {}, '/admin/events'),
    adminApi('/v1/admin/cities', AdminCityList, {}, '/admin/events'),
  ]);
  const next = new URLSearchParams(qs);
  if (page.nextCursor) next.set('cursor', page.nextCursor);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">{c.events}</h1>
        <Link href="/admin/events/new" className={`${primaryButton} flex items-center`}>
          {c.createCurated}
        </Link>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label={c.search}>
        <label className={labelClass} htmlFor="q">
          {c.search}
          <input id="q" name="q" defaultValue={q.q ?? ''} className={inputClass} />
        </label>
        <label className={labelClass} htmlFor="cityId">
          {c.city}
          <select id="cityId" name="cityId" defaultValue={q.cityId ?? ''} className={inputClass}>
            <option value="">{c.allCities}</option>
            {cities.items.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="type">
          {c.type}
          <select id="type" name="type" defaultValue={q.type ?? ''} className={inputClass}>
            <option value="">—</option>
            {EventType.options.map((v) => (
              <option key={v} value={v}>
                {c.types[v]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="status">
          {t.status}
          <select id="status" name="status" defaultValue={q.status ?? ''} className={inputClass}>
            <option value="">—</option>
            {EventStatus.options.map((v) => (
              <option key={v} value={v}>
                {c.statuses[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input
            type="checkbox"
            name="featured"
            value="true"
            defaultChecked={q.featured === true}
            className="size-5"
          />
          {c.featuredOnly}
        </label>
        <button type="submit" className={primaryButton}>
          {c.search}
        </button>
      </form>
      {page.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {[c.eventTitle, c.city, c.type, t.status, c.when, c.host, c.seats].map((h) => (
                  <th key={h} scope="col" className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((e) => (
                <tr
                  key={e.id}
                  className="border-t-2 border-border"
                  data-testid={`event-row-${e.id}`}
                >
                  <td className="p-2">
                    <Link href={`/admin/events/${e.id}`} className="font-semibold underline">
                      {e.title}
                    </Link>
                    {e.featured ? (
                      <span className="ml-2 rounded-full bg-primary px-2 text-sm text-on-primary">
                        {c.featured
                          .replace('{{until}}', istDateTime.format(new Date(e.featured.until)))
                          .replace('{{rank}}', String(e.featured.rank))}
                      </span>
                    ) : null}
                    {e.held ? <span className="ml-2 text-sm">{c.held}</span> : null}
                  </td>
                  <td className="p-2">{e.cityName}</td>
                  <td className="p-2">{c.types[e.type]}</td>
                  <td className="p-2">{c.statuses[e.status]}</td>
                  <td className="p-2">{istDateTime.format(new Date(e.startsAt))}</td>
                  <td className="p-2">{e.hostName ?? '—'}</td>
                  <td className="p-2">
                    {e.going}/{e.capacity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/events?${next.toString()}`}
          className="min-h-11 font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
