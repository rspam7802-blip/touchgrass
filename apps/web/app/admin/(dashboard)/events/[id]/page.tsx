import { AdminEventDetail, resources } from '@touchgrass/shared';
import { canOpen } from '../../../../../lib/admin-nav';
import { adminApi } from '../../../../../lib/admin-session';
import {
  inputClass,
  istDateTime,
  labelClass,
  NoAccess,
  primaryButton,
  secondaryButton,
} from '../../../../../lib/admin-ui';
import {
  cancelEventAction,
  featureEventAction,
  unfeatureEventAction,
  updateEventAction,
} from '../actions';

const t = resources.en.admin;
const c = t.console;

/** `datetime-local` value in IST for an instant. */
function istLocal(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

export default async function EventAdminPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canOpen('events'))) return <NoAccess />;
  const { id } = await params;
  const e = await adminApi(`/v1/admin/events/${id}`, AdminEventDetail, {}, `/admin/events/${id}`);
  const open = e.status === 'published' || e.status === 'draft';
  return (
    <>
      <h1 className="text-3xl font-extrabold">{e.title}</h1>
      <p data-testid="event-summary">
        {c.types[e.type]} · {c.statuses[e.status]} · {e.cityName} ·{' '}
        {istDateTime.format(new Date(e.startsAt))} · {e.going}/{e.capacity}
        {e.held ? ` · ${c.held}` : ''}
      </p>
      {e.cancelledReason ? <p>{e.cancelledReason}</p> : null}
      {e.featured ? (
        <p data-testid="featured-status" className="font-semibold">
          {c.featured
            .replace('{{until}}', istDateTime.format(new Date(e.featured.until)))
            .replace('{{rank}}', String(e.featured.rank))}
        </p>
      ) : null}

      {open ? (
        <>
          <section aria-labelledby="edit" className="flex flex-col gap-3">
            <h2 id="edit" className="text-xl font-bold">
              {c.editPlan}
            </h2>
            <form action={updateEventAction} className="flex flex-col gap-3" aria-labelledby="edit">
              <input type="hidden" name="id" value={e.id} />
              <label className={labelClass} htmlFor="title">
                {c.eventTitle}
                <input
                  id="title"
                  name="title"
                  required
                  minLength={3}
                  maxLength={80}
                  defaultValue={e.title}
                  className={inputClass}
                />
              </label>
              <label className={labelClass} htmlFor="description">
                {c.description}
                <textarea
                  id="description"
                  name="description"
                  maxLength={2000}
                  rows={4}
                  defaultValue={e.description}
                  className={`${inputClass} py-2`}
                />
              </label>
              <label className={labelClass} htmlFor="capacity">
                {c.capacity}
                <input
                  id="capacity"
                  name="capacity"
                  type="number"
                  min={2}
                  max={500}
                  required
                  defaultValue={e.capacity}
                  className={inputClass}
                />
              </label>
              <button type="submit" className={`${primaryButton} self-start`}>
                {c.saveChanges}
              </button>
            </form>
          </section>

          <section aria-labelledby="feature" className="flex flex-col gap-3">
            <h2 id="feature" className="text-xl font-bold">
              {c.feature}
            </h2>
            <form
              action={featureEventAction}
              className="flex flex-wrap items-end gap-3"
              aria-labelledby="feature"
            >
              <input type="hidden" name="id" value={e.id} />
              <label className={labelClass} htmlFor="until">
                {c.featureUntil}
                <input
                  id="until"
                  name="until"
                  type="datetime-local"
                  required
                  defaultValue={istLocal(e.startsAt)}
                  max={istLocal(e.endsAt)}
                  className={inputClass}
                />
              </label>
              <label className={labelClass} htmlFor="rank">
                {c.rank}
                <input
                  id="rank"
                  name="rank"
                  type="number"
                  min={1}
                  max={10}
                  required
                  defaultValue={e.featured?.rank ?? 1}
                  className={inputClass}
                />
              </label>
              <button type="submit" className={primaryButton}>
                {c.feature}
              </button>
            </form>
            {e.featured ? (
              <form action={unfeatureEventAction}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" className={secondaryButton}>
                  {c.unfeature}
                </button>
              </form>
            ) : null}
          </section>

          <section aria-labelledby="cancel" className="flex flex-col gap-3">
            <h2 id="cancel" className="text-xl font-bold">
              {c.cancelPlan}
            </h2>
            <form
              action={cancelEventAction}
              className="flex flex-wrap items-end gap-3"
              aria-labelledby="cancel"
            >
              <input type="hidden" name="id" value={e.id} />
              <label className={labelClass} htmlFor="reason">
                {c.cancelReason}
                <input
                  id="reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={300}
                  className={inputClass}
                />
              </label>
              <button type="submit" className={secondaryButton}>
                {c.cancelPlan}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </>
  );
}
