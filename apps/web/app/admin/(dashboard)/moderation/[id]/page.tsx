import { ErrorCode, ModerationItemDetail, resources, SanctionKind } from '@touchgrass/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { adminApi } from '../../../../../lib/admin-session';
import { resolveItemAction } from './actions';
import { canOpen } from '../../../../../lib/admin-nav';
import { NoAccess } from '../../../../../lib/admin-ui';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** One queue item (F-SAF-05, F-SAF-06): what was flagged or reported, and what to do about it. */
export default async function ModerationItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await canOpen('moderation'))) return <NoAccess />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const item = await adminApi(
    `/v1/admin/moderation/items/${id}`,
    ModerationItemDetail,
    {},
    `/admin/moderation/${id}`,
  );
  const error = ErrorCode.safeParse(sp.error);
  const matches = Array.isArray(item.details.matches)
    ? item.details.matches.filter((m): m is string => typeof m === 'string')
    : [];
  const p = item.preview;
  return (
    <>
      <Link href="/admin/moderation" className="min-h-11 self-start font-semibold underline">
        ← {t.moderation}
      </Link>
      <h1 className="text-3xl font-extrabold">{t.itemTitle}</h1>
      {error.success ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {error.data === 'CONFLICT'
            ? resources.en.events.reasons.ALREADY_RESOLVED
            : resources.en.errors[error.data]}
        </p>
      ) : null}
      <dl className="grid gap-1 sm:grid-cols-[12rem_1fr]">
        <dt className="font-semibold">{t.status}</dt>
        <dd data-testid="item-status">{t.itemStatuses[item.status]}</dd>
        <dt className="font-semibold">{t.severity}</dt>
        <dd>{item.severity}</dd>
        <dt className="font-semibold">{t.source}</dt>
        <dd>{item.source}</dd>
        <dt className="font-semibold">{t.target}</dt>
        <dd className="font-mono">
          {item.targetType}:{item.targetId}
        </dd>
        <dt className="font-semibold">{t.reports}</dt>
        <dd>{item.reportCount}</dd>
        <dt className="font-semibold">{t.when}</dt>
        <dd>{fmt.format(new Date(item.createdAt))}</dd>
        {p.owner ? (
          <>
            <dt className="font-semibold">{t.owner}</dt>
            <dd>
              <Link href={`/admin/users/${p.owner.id}`} className="underline">
                {p.owner.displayName || p.owner.id}
              </Link>
            </dd>
          </>
        ) : null}
      </dl>
      <section
        className="flex flex-col gap-2 rounded-2xl border-2 border-border p-4"
        data-testid="item-preview"
      >
        {p.gone ? (
          <p className="font-semibold">{t.alreadyGone}</p>
        ) : (
          <>
            {p.title ? <h2 className="text-xl font-bold">{p.title}</h2> : null}
            {p.text ? (
              <p>
                <span className="font-semibold">{t.flaggedText}: </span>
                {p.text}
              </p>
            ) : null}
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs
              <img
                src={p.image.md}
                alt={p.title || t.flaggedText}
                className="max-h-80 self-start rounded-xl"
              />
            ) : null}
          </>
        )}
        {matches.length > 0 ? (
          <p className="text-sm text-muted">{t.matches.replace('{{words}}', matches.join(', '))}</p>
        ) : null}
      </section>
      {item.status === 'open' ? (
        <form
          action={resolveItemAction}
          className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
          aria-label={t.resolve}
        >
          <input type="hidden" name="id" value={item.id} />
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">{t.outcome}</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="outcome" value="dismiss" defaultChecked /> {t.dismiss}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="outcome" value="remove" /> {t.removeContent}
            </label>
          </fieldset>
          <label className="flex flex-col gap-1 font-semibold" htmlFor="resolve-note">
            {t.note}
          </label>
          <input id="resolve-note" name="note" maxLength={500} className={input} />
          {p.owner ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">{t.alsoSanction}</legend>
              <label htmlFor="resolve-sanction" className="font-semibold">
                {t.sanctionKind}
              </label>
              <select id="resolve-sanction" name="sanction" defaultValue="" className={input}>
                <option value="">{t.none}</option>
                {SanctionKind.options.map((k) => (
                  <option key={k} value={k}>
                    {t.sanctions[k]}
                  </option>
                ))}
              </select>
              <label htmlFor="resolve-days" className="font-semibold">
                {t.days}
              </label>
              <input
                id="resolve-days"
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={1}
                className={input}
              />
              <label htmlFor="resolve-reason" className="font-semibold">
                {t.reason}
              </label>
              <input id="resolve-reason" name="reason" maxLength={500} className={input} />
            </fieldset>
          ) : null}
          <button
            type="submit"
            className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary"
          >
            {t.resolve}
          </button>
        </form>
      ) : null}
    </>
  );
}
