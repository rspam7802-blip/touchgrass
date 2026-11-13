import { AdminUserDetail, ErrorCode, resources, SanctionKind } from '@touchgrass/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { adminApi } from '../../../../../lib/admin-session';
import { liftAction, sanctionAction, setVerifiedAction } from './actions';
import { canOpen } from '../../../../../lib/admin-nav';
import { NoAccess } from '../../../../../lib/admin-ui';

const t = resources.en.admin;
const input = 'min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text';
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** One person's standing (F-SAF-05, F-WEB-03): status, badge, reports, and every action taken. */
export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await canOpen('users'))) return <NoAccess />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const u = await adminApi(`/v1/admin/users/${id}`, AdminUserDetail, {}, `/admin/users/${id}`);
  const error = ErrorCode.safeParse(sp.error);
  const show360 = await canOpen('customers');
  const now = Date.now();
  return (
    <>
      <Link href="/admin/users" className="min-h-11 self-start font-semibold underline">
        ← {t.users}
      </Link>
      <h1 className="text-3xl font-extrabold">{u.displayName ?? u.id}</h1>
      {show360 ? (
        <Link
          href={`/admin/customers/${u.id}`}
          className="flex min-h-11 items-center self-start rounded-full bg-primary px-6 font-bold text-on-primary"
          data-testid="open-customer-360"
        >
          {t.customer.open}
        </Link>
      ) : null}
      {error.success ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {error.data === 'FORBIDDEN'
            ? resources.en.events.reasons.STAFF_ACCOUNT
            : resources.en.errors[error.data]}
        </p>
      ) : null}
      <dl className="grid gap-1 sm:grid-cols-[12rem_1fr]">
        <dt className="font-semibold">{t.status}</dt>
        <dd data-testid="user-status">{t.userStatuses[u.status]}</dd>
        <dt className="font-semibold">{t.verifiedCol}</dt>
        <dd data-testid="user-verified">{u.verified ? '✓' : '—'}</dd>
        <dt className="font-semibold">{t.phone}</dt>
        <dd>{u.phoneLast4 ? t.phoneEnding.replace('{{last4}}', u.phoneLast4) : '—'}</dd>
        <dt className="font-semibold">{t.joined}</dt>
        <dd>{fmt.format(new Date(u.createdAt))}</dd>
        <dt className="font-semibold">{t.reportsAgainst}</dt>
        <dd>{u.reportsAgainst}</dd>
        {u.roles.length > 0 ? (
          <>
            <dt className="font-semibold">{t.roles.replace('{{roles}}', '')}</dt>
            <dd>{u.roles.join(', ')}</dd>
          </>
        ) : null}
        {u.mutedUntil ? (
          <>
            <dt className="font-semibold">{t.sanctions.mute}</dt>
            <dd>{t.mutedUntil.replace('{{date}}', fmt.format(new Date(u.mutedUntil)))}</dd>
          </>
        ) : null}
        {u.suspendedUntil ? (
          <>
            <dt className="font-semibold">{t.sanctions.suspend}</dt>
            <dd>{t.suspendedUntil.replace('{{date}}', fmt.format(new Date(u.suspendedUntil)))}</dd>
          </>
        ) : null}
      </dl>
      <form action={setVerifiedAction}>
        <input type="hidden" name="userId" value={u.id} />
        <input type="hidden" name="verified" value={u.verified ? 'false' : 'true'} />
        <button
          type="submit"
          className="min-h-11 rounded-full border-2 border-border px-6 font-semibold"
        >
          {u.verified ? t.unverify : t.markVerified}
        </button>
      </form>

      <h2 className="text-2xl font-bold">{t.sanctionHistory}</h2>
      {u.sanctions.length === 0 ? (
        <p>{t.noSanctions}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {u.sanctions.map((s) => {
            const running =
              s.kind !== 'warn' &&
              s.liftedAt === null &&
              (s.until === null || new Date(s.until).getTime() > now);
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-border p-3"
                data-testid={`sanction-${s.kind}`}
              >
                <span className="font-bold">{t.sanctions[s.kind]}</span>
                <span>{s.reason}</span>
                <span className="text-sm text-muted">
                  {fmt.format(new Date(s.createdAt))}
                  {s.byName ? ` · ${t.by}: ${s.byName}` : ''}
                  {s.until
                    ? ` · ${t.untilDate.replace('{{date}}', fmt.format(new Date(s.until)))}`
                    : ''}
                  {s.liftedAt
                    ? ` · ${t.lifted.replace('{{date}}', fmt.format(new Date(s.liftedAt)))}`
                    : ''}
                </span>
                {running ? (
                  <form action={liftAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="sanctionId" value={s.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-full border-2 border-border px-4 font-semibold"
                      aria-label={`${t.lift}: ${t.sanctions[s.kind]}`}
                    >
                      {t.lift}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <form
        action={sanctionAction}
        className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
        aria-label={t.applySanction}
      >
        <input type="hidden" name="userId" value={u.id} />
        <label htmlFor="sanction-kind" className="font-semibold">
          {t.sanctionKind}
        </label>
        <select id="sanction-kind" name="kind" defaultValue="warn" className={input}>
          {SanctionKind.options.map((k) => (
            <option key={k} value={k}>
              {t.sanctions[k]}
            </option>
          ))}
        </select>
        <label htmlFor="sanction-days" className="font-semibold">
          {t.days}
        </label>
        <input
          id="sanction-days"
          name="days"
          type="number"
          min={1}
          max={365}
          defaultValue={7}
          className={input}
        />
        <label htmlFor="sanction-reason" className="font-semibold">
          {t.reason}
        </label>
        <input
          id="sanction-reason"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          className={input}
        />
        <button
          type="submit"
          className="min-h-11 self-start rounded-full bg-primary px-6 font-bold text-on-primary"
        >
          {t.applySanction}
        </button>
      </form>
    </>
  );
}
