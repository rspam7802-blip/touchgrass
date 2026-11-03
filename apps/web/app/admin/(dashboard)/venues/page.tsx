import { AdminVenueList, resources } from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { createPerkAction, partnerAction, togglePerkAction } from './actions';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
const ghost = 'min-h-11 rounded-full border-2 border-border px-4 font-semibold';

/** Venues, partnerships and perks (F-PAY-04). */
export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; partner?: string; cursor?: string }>;
}) {
  if (!(await canOpen('venues'))) return <NoAccess />;
  const sp = await searchParams;
  const partner = sp.partner === 'partners' ? 'partners' : 'all';
  const qs = new URLSearchParams({
    partner,
    limit: '25',
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.cursor ? { cursor: sp.cursor } : {}),
  });
  const page = await adminApi(
    `/v1/admin/venues?${qs.toString()}`,
    AdminVenueList,
    {},
    '/admin/venues',
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.venuesPerks}</h1>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="flex flex-col gap-1 font-semibold" htmlFor="q">
          {t.search}
          <input id="q" name="q" defaultValue={sp.q ?? ''} className={input} />
        </label>
        <label className="flex min-h-11 items-center gap-2 font-semibold" htmlFor="partner">
          <input
            id="partner"
            type="checkbox"
            name="partner"
            value="partners"
            defaultChecked={partner === 'partners'}
            className="h-5 w-5"
          />
          {t.partner}
        </label>
        <button type="submit" className={ghost}>
          {t.search}
        </button>
      </form>
      {page.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {page.items.map((v) => (
            <li
              key={v.id}
              className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
              data-testid={`venue-${v.name}`}
            >
              <h2 className="text-xl font-bold">{v.name}</h2>
              <p className="text-muted">
                {v.address}
                {v.neighbourhoodName ? ` · ${v.neighbourhoodName}` : ''} · {t.redemptions}:{' '}
                {v.redemptions} · {v.hasStaffPin ? t.pinSet : t.noPin}
              </p>
              <form action={partnerAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={v.id} />
                <label
                  className="flex min-h-11 items-center gap-2 font-semibold"
                  htmlFor={`partner-${v.id}`}
                >
                  <input type="hidden" name="isPartner" value="false" />
                  <input
                    id={`partner-${v.id}`}
                    type="checkbox"
                    name="isPartner"
                    value="true"
                    defaultChecked={v.isPartner}
                    className="h-5 w-5"
                  />
                  {t.makePartner}
                </label>
                <label className="flex flex-col gap-1 font-semibold" htmlFor={`pin-${v.id}`}>
                  {t.staffPinLabel}
                  <input
                    id={`pin-${v.id}`}
                    name="staffPin"
                    inputMode="numeric"
                    pattern="[0-9]{4,8}"
                    autoComplete="off"
                    className={input}
                  />
                </label>
                <label
                  className="flex flex-col gap-1 font-semibold sm:col-span-2"
                  htmlFor={`desc-${v.id}`}
                >
                  {t.perkDescription}
                  <input
                    id={`desc-${v.id}`}
                    name="description"
                    defaultValue={v.description}
                    maxLength={500}
                    className={input}
                  />
                </label>
                <button
                  type="submit"
                  className={`${ghost} self-start`}
                  aria-label={`${t.save}: ${v.name}`}
                >
                  {t.save}
                </button>
              </form>
              {v.perks.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {v.perks.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">{p.title}</span>
                      <span className="text-muted">
                        {t.minGroup}: {p.minGroupSize} · {p.active ? t.enabled : t.disabled}
                      </span>
                      <form action={togglePerkAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="title" value={p.title} />
                        <input type="hidden" name="description" value={p.description} />
                        <input type="hidden" name="minGroupSize" value={p.minGroupSize} />
                        <input type="hidden" name="validUntil" value={p.validUntil ?? ''} />
                        <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                        <button
                          type="submit"
                          className={ghost}
                          aria-label={`${p.active ? resources.en.admin.disabled : resources.en.admin.enabled}: ${p.title}`}
                        >
                          {t.toggle.replace('{{state}}', p.active ? t.disabled : t.enabled)}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
              {v.isPartner ? (
                <form action={createPerkAction} className="grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="venueId" value={v.id} />
                  <label
                    className="flex flex-col gap-1 font-semibold sm:col-span-2"
                    htmlFor={`title-${v.id}`}
                  >
                    {t.perkTitle}
                    <input
                      id={`title-${v.id}`}
                      name="title"
                      required
                      minLength={3}
                      maxLength={80}
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1 font-semibold" htmlFor={`min-${v.id}`}>
                    {t.minGroup}
                    <input
                      id={`min-${v.id}`}
                      name="minGroupSize"
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={1}
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1 font-semibold" htmlFor={`until-${v.id}`}>
                    {t.validUntil}
                    <input id={`until-${v.id}`} name="validUntil" type="date" className={input} />
                  </label>
                  <input type="hidden" name="description" value="" />
                  <button
                    type="submit"
                    className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary"
                    aria-label={`${t.addPerk}: ${v.name}`}
                  >
                    {t.addPerk}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/venues?${new URLSearchParams({ partner, ...(sp.q ? { q: sp.q } : {}), cursor: page.nextCursor }).toString()}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
