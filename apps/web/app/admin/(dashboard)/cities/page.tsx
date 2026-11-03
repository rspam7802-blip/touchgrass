import {
  type AdminCity,
  AdminCityList,
  CityLaunchStatus,
  resources,
  SUPPORTED_LANGUAGES,
} from '@touchgrass/shared';
import { canOpen, currentRoles } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import { inputClass, labelClass, NoAccess, primaryButton } from '../../../../lib/admin-ui';
import { addNeighbourhoodAction, saveCityAction } from './actions';

const t = resources.en.admin;
const c = t.console;
const LANG_NAMES = { en: 'English', te: 'తెలుగు', hi: 'हिन्दी' } as const;

function CityForm({ city, idPrefix }: { city: AdminCity | null; idPrefix: string }) {
  const field = (
    name: string,
    label: string,
    value: string | number,
    type = 'text',
    step?: string,
  ) => (
    <label className={labelClass} htmlFor={`${idPrefix}-${name}`}>
      {label}
      <input
        id={`${idPrefix}-${name}`}
        name={name}
        type={type}
        step={step}
        required
        defaultValue={value}
        className={inputClass}
      />
    </label>
  );
  return (
    <form
      action={saveCityAction}
      className="grid gap-3 sm:grid-cols-2"
      aria-label={city ? c.editCity.replace('{{name}}', city.name) : c.addCity}
    >
      <input type="hidden" name="id" value={city?.id ?? ''} />
      {field('name', c.cityName, city?.name ?? '')}
      {field('slug', c.slug, city?.slug ?? '')}
      {field('lat', c.centreLat, city?.centre.lat ?? '', 'number', 'any')}
      {field('lng', c.centreLng, city?.centre.lng ?? '', 'number', 'any')}
      {field('south', c.boundsSouth, city?.bounds.south ?? '', 'number', 'any')}
      {field('west', c.boundsWest, city?.bounds.west ?? '', 'number', 'any')}
      {field('north', c.boundsNorth, city?.bounds.north ?? '', 'number', 'any')}
      {field('east', c.boundsEast, city?.bounds.east ?? '', 'number', 'any')}
      {field('timezone', c.timezone, city?.timezone ?? 'Asia/Kolkata')}
      <label className={labelClass} htmlFor={`${idPrefix}-launchStatus`}>
        {c.launchStatus}
        <select
          id={`${idPrefix}-launchStatus`}
          name="launchStatus"
          defaultValue={city?.launchStatus ?? 'waitlist'}
          className={inputClass}
        >
          {CityLaunchStatus.options.map((s) => (
            <option key={s} value={s}>
              {c.launchStatuses[s]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap gap-4 sm:col-span-2">
        <legend className="font-semibold">{c.languages}</legend>
        {SUPPORTED_LANGUAGES.map((l) => (
          <label key={l} className="flex min-h-11 items-center gap-2" lang={l}>
            <input
              type="checkbox"
              name="languages"
              value={l}
              defaultChecked={city ? city.languages.includes(l) : true}
              className="size-5"
            />
            {LANG_NAMES[l]}
          </label>
        ))}
      </fieldset>
      <button type="submit" className={`${primaryButton} sm:col-span-2 sm:justify-self-start`}>
        {city ? t.save : c.addCity}
      </button>
    </form>
  );
}

export default async function CitiesPage() {
  if (!(await canOpen('cities'))) return <NoAccess />;
  const roles = await currentRoles();
  const canEdit = roles.includes('admin') || roles.includes('super_admin');
  const data = await adminApi('/v1/admin/cities', AdminCityList, {}, '/admin/cities');
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.cities}</h1>
      <ul className="flex flex-col gap-4">
        {data.items.map((city) => (
          <li
            key={city.id}
            className="flex flex-col gap-3 rounded-2xl border-2 border-border bg-surface p-5"
            data-testid={`city-${city.slug}`}
          >
            <h2 className="text-xl font-bold">
              {city.name} · {c.launchStatuses[city.launchStatus]}
            </h2>
            <p>
              {city.timezone} · {city.languages.map((l) => l.toUpperCase()).join(', ')} ·{' '}
              {c.waitlistCount.replace('{{count}}', String(city.waitlist))}
            </p>
            <p>
              <span className="font-semibold">{c.curators}: </span>
              {city.curators.length
                ? city.curators.map((u) => u.displayName ?? u.userId).join(', ')
                : c.noCurators}
            </p>
            <h3 className="font-semibold">{c.neighbourhoods}</h3>
            <ul className="flex flex-wrap gap-2">
              {city.neighbourhoods.map((n) => (
                <li key={n.id} className="rounded-full border-2 border-border px-3 py-1">
                  {n.name}
                </li>
              ))}
            </ul>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {c.addNeighbourhood}
              </summary>
              <form
                action={addNeighbourhoodAction}
                className="grid gap-3 sm:grid-cols-2"
                aria-label={`${c.addNeighbourhood}: ${city.name}`}
              >
                <input type="hidden" name="cityId" value={city.id} />
                {(
                  [
                    ['name', c.cityName, 'text', undefined],
                    ['slug', c.slug, 'text', undefined],
                    ['lat', c.centreLat, 'number', 'any'],
                    ['lng', c.centreLng, 'number', 'any'],
                    ['radiusKm', c.radiusKm, 'number', '0.5'],
                  ] as const
                ).map(([name, label, type, step]) => (
                  <label key={name} className={labelClass} htmlFor={`${city.id}-hood-${name}`}>
                    {label}
                    <input
                      id={`${city.id}-hood-${name}`}
                      name={name}
                      type={type}
                      step={step}
                      required
                      className={inputClass}
                    />
                  </label>
                ))}
                <button
                  type="submit"
                  className={`${primaryButton} sm:col-span-2 sm:justify-self-start`}
                >
                  {c.add}
                </button>
              </form>
            </details>
            {canEdit ? (
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  {c.editCity.replace('{{name}}', city.name)}
                </summary>
                <CityForm city={city} idPrefix={city.slug} />
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      {data.requested.length ? (
        <section aria-labelledby="requested" className="flex flex-col gap-2">
          <h2 id="requested" className="text-xl font-bold">
            {c.requested}
          </h2>
          <ul className="flex flex-col gap-1">
            {data.requested.map((r) => (
              <li key={r.name}>
                {r.name} · {c.waitlistCount.replace('{{count}}', String(r.count))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {canEdit ? (
        <section aria-labelledby="add-city" className="flex flex-col gap-3">
          <h2 id="add-city" className="text-xl font-bold">
            {c.addCity}
          </h2>
          <CityForm city={null} idPrefix="new-city" />
        </section>
      ) : null}
    </>
  );
}
