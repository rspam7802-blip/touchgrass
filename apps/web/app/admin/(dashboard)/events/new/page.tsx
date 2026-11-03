import { AdminVenueList, InterestList, resources } from '@touchgrass/shared';
import { canOpen } from '../../../../../lib/admin-nav';
import { adminApi, parse, rawApi } from '../../../../../lib/admin-session';
import { inputClass, labelClass, NoAccess, primaryButton } from '../../../../../lib/admin-ui';
import { createCuratedAction } from '../actions';

const t = resources.en.admin;
const c = t.console;

export default async function NewCuratedPage() {
  if (!(await canOpen('events'))) return <NoAccess />;
  const [venues, interests] = await Promise.all([
    adminApi('/v1/admin/venues?limit=100', AdminVenueList, {}, '/admin/events/new'),
    rawApi('/v1/interests').then((r) => parse(r, InterestList)),
  ]);
  const text = (name: string, label: string, required = true, type = 'text', step?: string) => (
    <label className={labelClass} htmlFor={name}>
      {label}
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        required={required}
        className={inputClass}
      />
    </label>
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{c.createCurated}</h1>
      <form
        action={createCuratedAction}
        className="grid gap-3 sm:grid-cols-2"
        aria-label={c.createCurated}
      >
        {text('title', c.eventTitle)}
        <label className={labelClass} htmlFor="categoryInterestId">
          {c.category}
          <select id="categoryInterestId" name="categoryInterestId" required className={inputClass}>
            {interests.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.emoji} {i.name.en}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-2`} htmlFor="description">
          {c.description}
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={2000}
            className={`${inputClass} py-2`}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`} htmlFor="venueId">
          {c.venue}
          <select id="venueId" name="venueId" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {venues.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {text('placeName', c.placeName, false)}
        {text('address', c.address, false)}
        {text('lat', c.centreLat, false, 'number', 'any')}
        {text('lng', c.centreLng, false, 'number', 'any')}
        {text('startsAt', c.startsAt, true, 'datetime-local')}
        {text('endsAt', c.endsAt, true, 'datetime-local')}
        {text('capacity', c.capacity, true, 'number')}
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          {(
            [
              ['publish', c.publishNow],
              ['soloFriendly', c.soloFriendly],
              ['indoor', c.indoor],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex min-h-11 items-center gap-2 font-semibold">
              <input
                type="checkbox"
                name={name}
                defaultChecked={name === 'publish'}
                className="size-5"
              />
              {label}
            </label>
          ))}
        </div>
        <button type="submit" className={`${primaryButton} sm:col-span-2 sm:justify-self-start`}>
          {c.create}
        </button>
      </form>
    </>
  );
}
