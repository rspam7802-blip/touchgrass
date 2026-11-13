import {
  canAccessSection,
  LaunchWaitlistEntry,
  paginated,
  resources,
  WaitlistInsights,
} from '@touchgrass/shared';
import Link from 'next/link';
import { canOpen, currentRoles } from '../../../../lib/admin-nav';
import { adminApi } from '../../../../lib/admin-session';
import { inputClass, NoAccess, secondaryButton } from '../../../../lib/admin-ui';
import { WaitlistInsightsPanel } from './insights';
import { InviteButton, RemoveButton } from './row-actions';

const t = resources.en.admin.waitlist;
const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** People who asked for an invite on the website (D-169): invite them, or remove them on request. */
export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string; days?: string }>;
}) {
  if (!(await canOpen('waitlist'))) return <NoAccess />;
  const canInvite = canAccessSection(await currentRoles(), 'inviteCodes');
  const { cursor, status: rawStatus, days: rawDays } = await searchParams;
  const days = [7, 30, 90].find((d) => String(d) === rawDays) ?? 30;
  const status = rawStatus === 'all' || rawStatus === 'invited' ? rawStatus : 'waiting';
  const qs = new URLSearchParams({ limit: '50', status, ...(cursor ? { cursor } : {}) });
  const [page, insights] = await Promise.all([
    adminApi(
      `/v1/admin/waitlist?${qs.toString()}`,
      paginated(LaunchWaitlistEntry),
      {},
      `/admin/waitlist?status=${status}`,
    ),
    adminApi(
      `/v1/admin/waitlist/insights?days=${String(days)}`,
      WaitlistInsights,
      {},
      `/admin/waitlist?status=${status}`,
    ),
  ]);
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.title}</h1>
      <p className="max-w-2xl">{t.intro}</p>
      <WaitlistInsightsPanel data={insights} status={status} />
      <h2>{t.people}</h2>
      <form className="flex flex-wrap items-end gap-3">
        <label htmlFor="waitlist-status" className="flex flex-col gap-1 font-semibold">
          {t.show}
          <select id="waitlist-status" name="status" defaultValue={status} className={inputClass}>
            <option value="waiting">{t.waiting}</option>
            <option value="invited">{t.invitedNotJoined}</option>
            <option value="all">{t.all}</option>
          </select>
        </label>
        <button type="submit" className={secondaryButton}>
          {t.apply}
        </button>
      </form>
      {page.items.length === 0 ? (
        <p>{resources.en.admin.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">
                  {t.name}
                </th>
                <th scope="col" className="p-2">
                  {t.contact}
                </th>
                <th scope="col" className="p-2">
                  {t.city}
                </th>
                <th scope="col" className="p-2">
                  {t.note}
                </th>
                <th scope="col" className="p-2">
                  {t.joined}
                </th>
                <th scope="col" className="p-2">
                  {t.status}
                </th>
                <th scope="col" className="p-2">
                  <span className="sr-only">{`${t.invite} / ${t.remove}`}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border align-top"
                  data-testid={`waitlist-row-${e.id}`}
                >
                  <td className="p-2 font-semibold [overflow-wrap:anywhere]">{e.name}</td>
                  <td className="p-2 [overflow-wrap:anywhere]">
                    {e.phone ? <div className="font-mono">{e.phone}</div> : null}
                    {e.email ? <div>{e.email}</div> : null}
                  </td>
                  <td className="p-2">
                    <div>{e.city}</div>
                    {e.source || e.referrer ? (
                      <div className="text-sm text-muted" data-testid={`waitlist-source-${e.id}`}>
                        {e.referrer
                          ? t.referredBy.replace('{{name}}', e.referrer.name)
                          : t.from.replace('{{source}}', e.source ?? '')}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-xs p-2 [overflow-wrap:anywhere]">{e.note ?? ''}</td>
                  <td className="p-2">{fmt.format(new Date(e.createdAt))}</td>
                  <td className="p-2">
                    {e.invitedAt ? (
                      <>
                        <div>
                          {t.invitedOn.replace('{{date}}', fmt.format(new Date(e.invitedAt)))}
                        </div>
                        {e.inviteCode ? (
                          <div className="select-all font-mono font-bold">{e.inviteCode}</div>
                        ) : null}
                        {e.reinviteCount && e.reinvitedAt ? (
                          <div className="text-sm text-muted">
                            {t.reinvited
                              .replace('{{count}}', String(e.reinviteCount))
                              .replace('{{date}}', fmt.format(new Date(e.reinvitedAt)))}
                          </div>
                        ) : null}
                        <div
                          className={e.joinedAt ? 'font-semibold' : 'text-sm text-muted'}
                          data-testid={`waitlist-joined-${e.id}`}
                        >
                          {e.joinedAt
                            ? t.joinedOn.replace('{{date}}', fmt.format(new Date(e.joinedAt)))
                            : t.notJoinedYet}
                        </div>
                      </>
                    ) : (
                      t.waitingStatus
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-col gap-2">
                      {canInvite && !e.invitedAt ? <InviteButton id={e.id} name={e.name} /> : null}
                      {canInvite && e.invitedAt && !e.joinedAt ? (
                        <InviteButton id={e.id} name={e.name} again />
                      ) : null}
                      <RemoveButton id={e.id} name={e.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/waitlist?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {resources.en.admin.loadMore}
        </Link>
      ) : null}
    </>
  );
}
