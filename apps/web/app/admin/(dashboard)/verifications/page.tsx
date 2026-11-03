import {
  AdminVerificationList,
  ErrorCode,
  resources,
  VerificationRejectReason,
} from '@touchgrass/shared';
import Link from 'next/link';
import { adminApi } from '../../../../lib/admin-session';
import { reviewVerificationAction } from './actions';
import { canOpen } from '../../../../lib/admin-nav';
import { NoAccess } from '../../../../lib/admin-ui';

const t = resources.en.admin;
const v = resources.en.verification;
const fmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** Selfie review queue (F-SAF-01): compare the pose and face with the profile photos, oldest first. */
export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; error?: string; done?: string }>;
}) {
  if (!(await canOpen('verifications'))) return <NoAccess />;
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '20', ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  const page = await adminApi(
    `/v1/admin/verifications?${qs.toString()}`,
    AdminVerificationList,
    {},
    '/admin/verifications',
  );
  const error = ErrorCode.safeParse(sp.error);
  return (
    <>
      <h1 className="text-3xl font-extrabold">{t.verifications}</h1>
      {error.success ? (
        <p role="alert" className="font-semibold text-[var(--tg-danger)]">
          {resources.en.errors[error.data]}
        </p>
      ) : null}
      {sp.done ? (
        <p role="status" className="font-semibold text-primary">
          {t.verificationDone}
        </p>
      ) : null}
      {page.items.length === 0 ? (
        <p>{t.verificationsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {page.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4"
              data-testid={`verification-${item.user.id}`}
            >
              <h2 className="text-xl font-bold">
                {item.user.displayName}
                {item.user.gender ? ` · ${item.user.gender}` : ''} ·{' '}
                {fmt.format(new Date(item.submittedAt))}
              </h2>
              <p>
                <span className="font-semibold">{t.pose}:</span> {v.poses[item.pose]}
              </p>
              <p data-testid="face-match">
                {item.faceSimilarity === null
                  ? t.faceUnknown
                  : t.faceMatch.replace('{{score}}', String(Math.round(item.faceSimilarity)))}
              </p>
              <div className="flex flex-wrap gap-3">
                {item.selfie ? (
                  <figure className="flex flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs */}
                    <img
                      src={item.selfie.md}
                      alt={`${t.selfie}: ${item.user.displayName}`}
                      className="h-48 w-36 rounded-xl object-cover"
                    />
                    <figcaption className="text-sm text-muted">{t.selfie}</figcaption>
                  </figure>
                ) : null}
                {item.profilePhotos.map((p, i) => (
                  <figure key={p.md} className="flex flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs */}
                    <img
                      src={p.md}
                      alt={`${t.profilePhotos} ${String(i + 1)}: ${item.user.displayName}`}
                      className="h-48 w-36 rounded-xl object-cover"
                    />
                    <figcaption className="text-sm text-muted">{t.profilePhotos}</figcaption>
                  </figure>
                ))}
              </div>
              <form action={reviewVerificationAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={item.id} />
                <button
                  type="submit"
                  name="decision"
                  value="approved"
                  className="min-h-11 rounded-full bg-primary px-6 font-bold text-on-primary"
                  aria-label={`${t.approve}: ${item.user.displayName}`}
                >
                  {t.approve}
                </button>
                <label htmlFor={`reason-${item.id}`} className="font-semibold">
                  {t.rejectReason}
                </label>
                <select
                  id={`reason-${item.id}`}
                  name="reason"
                  className="min-h-11 rounded-xl border-2 border-input bg-surface px-3 text-text"
                  defaultValue="POSE_MISMATCH"
                >
                  {VerificationRejectReason.options.map((r) => (
                    <option key={r} value={r}>
                      {v.rejectReasons[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  name="decision"
                  value="rejected"
                  className="min-h-11 rounded-full border-2 border-border px-6 font-semibold"
                  aria-label={`${t.reject}: ${item.user.displayName}`}
                >
                  {t.reject}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <Link
          href={`/admin/verifications?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="min-h-11 self-start font-semibold underline"
        >
          {t.loadMore}
        </Link>
      ) : null}
    </>
  );
}
