import { AdminPaymentsOverview, formatPaise, resources } from '@touchgrass/shared';
import { adminApi } from '../../../../lib/admin-session';
import { retryAction } from './actions';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const p = resources.en.payments;
const h = resources.en.hosting;
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
const th = 'p-2 text-left';
const money = (n: number): string => formatPaise(n, 'en');

function RetryButton({
  kind,
  id,
  label,
}: {
  kind: 'refunds' | 'payouts';
  id: string;
  label: string;
}) {
  return (
    <form action={retryAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="min-h-11 rounded-full border-2 border-border px-4 font-semibold"
        aria-label={label}
      >
        {t.retry}
      </button>
    </form>
  );
}

/** Payments, refunds and payouts overview (F-WEB-03). */
export default async function PaymentsPage() {
  if (!(await canOpen('payments'))) return <NoAccess />;
  const o = await adminApi('/v1/admin/payments', AdminPaymentsOverview, {}, '/admin/payments');
  const totals: [string, number][] = [
    [t.captured, o.totals.capturedPaise],
    [t.refunded, o.totals.refundedPaise],
    [t.platformFee, o.totals.platformFeePaise],
    [t.gst, o.totals.gstPaise],
    [t.payoutsPaid, o.totals.payoutsPaidPaise],
    [t.payoutsPending, o.totals.payoutsPendingPaise],
  ];
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.payments}</h1>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="payment-totals">
        {totals.map(([label, value]) => (
          <div key={label} className="rounded-2xl border-2 border-border p-3">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-xl font-bold">{money(value)}</dd>
          </div>
        ))}
      </dl>

      <h2 className="text-2xl font-bold">{t.recentPayments}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-2 border-border">
              <th scope="col" className={th}>
                {t.when}
              </th>
              <th scope="col" className={th}>
                {t.buyer}
              </th>
              <th scope="col" className={th}>
                {t.event}
              </th>
              <th scope="col" className={th}>
                {t.amount}
              </th>
              <th scope="col" className={th}>
                {t.status}
              </th>
            </tr>
          </thead>
          <tbody>
            {o.payments.map((x) => (
              <tr key={x.id} className="border-b border-border">
                <td className="p-2">{fmt.format(new Date(x.createdAt))}</td>
                <td className="p-2">{x.buyer.displayName}</td>
                <td className="p-2">{x.eventTitle}</td>
                <td className="p-2">{money(x.amountPaise)}</td>
                <td className="p-2">
                  {p.status[x.status]}
                  {x.method ? ` · ${x.method.toUpperCase()}` : ''}
                  {x.receiptNumber ? ` · ${x.receiptNumber}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-2xl font-bold">{t.recentRefunds}</h2>
      {o.refunds.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className={th}>
                  {t.when}
                </th>
                <th scope="col" className={th}>
                  {t.event}
                </th>
                <th scope="col" className={th}>
                  {t.amount}
                </th>
                <th scope="col" className={th}>
                  {t.status}
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">{t.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {o.refunds.map((r) => (
                <tr key={r.id} className="border-b border-border" data-testid={`refund-${r.id}`}>
                  <td className="p-2">{fmt.format(new Date(r.createdAt))}</td>
                  <td className="p-2">{r.eventTitle}</td>
                  <td className="p-2">{money(r.amountPaise)}</td>
                  <td className="p-2">
                    {p.refundStatus[r.status]} · {r.reason}
                  </td>
                  <td className="p-2">
                    {r.status === 'failed' ? (
                      <RetryButton kind="refunds" id={r.id} label={`${t.retry}: ${r.eventTitle}`} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-2xl font-bold">{t.recentPayouts}</h2>
      {o.payouts.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className={th}>
                  {t.host}
                </th>
                <th scope="col" className={th}>
                  {t.event}
                </th>
                <th scope="col" className={th}>
                  {h.gross}
                </th>
                <th scope="col" className={th}>
                  {h.net}
                </th>
                <th scope="col" className={th}>
                  {t.status}
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">{t.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {o.payouts.map((x) => (
                <tr
                  key={x.id}
                  className="border-b border-border"
                  data-testid={`payout-${x.eventTitle}`}
                >
                  <td className="p-2">{x.host.displayName}</td>
                  <td className="p-2">{x.eventTitle}</td>
                  <td className="p-2">{money(x.grossPaise)}</td>
                  <td className="p-2">{money(x.netPaise)}</td>
                  <td className="p-2">
                    {h.payoutStatus[x.status]}
                    {x.holdReason ? ` · ${x.holdReason}` : ''}
                  </td>
                  <td className="p-2">
                    {x.status === 'failed' ? (
                      <RetryButton kind="payouts" id={x.id} label={`${t.retry}: ${x.eventTitle}`} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
