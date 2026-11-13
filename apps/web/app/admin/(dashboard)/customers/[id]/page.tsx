import {
  type CustomerPlan,
  type CustomerTimelineItem,
  CustomerView,
  formatPaise,
  resources,
} from '@touchgrass/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { canOpen } from '../../../../../lib/admin-nav';
import { adminApi } from '../../../../../lib/admin-session';
import { istDateTime, NoAccess } from '../../../../../lib/admin-ui';

const t = resources.en.admin.customer;
const en = resources.en;
const money = (n: number): string => formatPaise(n, 'en');
const istDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const when = (iso: string | null): string => (iso ? istDateTime.format(new Date(iso)) : '—');
const fill = (s: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{{${k}}}`, String(v)), s);

function Stat({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="admin-card flex flex-col gap-1" data-testid={testId}>
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="text-2xl font-extrabold">{value}</span>
    </div>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold">{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-6 flex-col gap-4">
      <h2 id={`${id}-h`} className="text-2xl font-extrabold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Person({ id, name }: { id: string; name: string | null }) {
  return (
    <Link href={`/admin/customers/${id}`} className="font-semibold underline">
      {name ?? t.deletedUser}
    </Link>
  );
}

function planStatus(p: CustomerPlan): string {
  if (p.eventStatus === 'cancelled') return t.plan.planCancelled;
  if (p.noShow) return t.plan.noShow;
  if (p.lateCancel) return t.plan.lateCancel;
  if (p.role !== 'guest') return en.admin.console.statuses[p.eventStatus];
  return p.rsvp ? t.rsvp[p.rsvp] : '—';
}

function timelineText(item: CustomerTimelineItem): string {
  const label =
    item.kind === 'sanction' && item.label
      ? ((en.admin.sanctions as Record<string, string | undefined>)[item.label] ?? item.label)
      : (item.label ?? t.deletedUser);
  return fill(t.timeline[item.kind], { name: label });
}

/** Customer 360 (D-192): everything about one person on one page, for admins (full) and support (lighter). */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canOpen('customers'))) return <NoAccess />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const v = await adminApi(`/v1/admin/customers/${id}`, CustomerView, {}, `/admin/customers/${id}`);
  const name = v.user.displayName ?? t.deletedUser;
  const p = v.profile;
  const sections = [
    ['overview', t.sections.overview],
    ['plans', t.sections.plans],
    ...(v.spend ? [['spending', t.sections.spending]] : []),
    ['social', t.sections.social],
    ...(v.safety ? [['safety', t.sections.safety]] : []),
    ['timeline', t.sections.timeline],
  ] as [string, string][];
  const rating = (r: { average: number | null; count: number }): string =>
    r.average === null
      ? `— (${String(r.count)})`
      : fill(t.stats.ratingOf, { rating: r.average, count: r.count });

  return (
    <>
      <Link
        href={`/admin/users/${v.user.id}`}
        className="min-h-11 self-start font-semibold underline"
      >
        ← {en.admin.users}
      </Link>
      <header
        className="admin-card flex flex-wrap items-center gap-5"
        data-testid="customer-header"
      >
        {v.photo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs */}
            <img src={v.photo.md} alt={name} className="size-24 rounded-full object-cover" />
          </>
        ) : (
          <span
            aria-hidden="true"
            className="flex size-24 items-center justify-center rounded-full bg-surface-alt text-3xl font-extrabold"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-semibold text-muted">{t.title}</p>
          <h1 className="text-3xl font-extrabold">{name}</h1>
          <p className="flex flex-wrap gap-2 text-sm">
            <span
              className="rounded-full bg-surface-alt px-3 py-1 font-semibold"
              data-testid="customer-status"
            >
              {en.admin.userStatuses[v.user.status]}
            </span>
            {v.user.verified ? (
              <span className="rounded-full bg-surface-alt px-3 py-1 font-semibold">
                {en.admin.verifiedCol}
              </span>
            ) : null}
            <span className="rounded-full bg-surface-alt px-3 py-1 font-semibold">
              {en.profile.tiers[v.reliability.tier]}
            </span>
          </p>
        </div>
      </header>
      <p className="text-sm text-muted" data-testid="customer-access">
        {v.access === 'full' ? t.fullView : t.supportView} {t.private}
      </p>
      <nav aria-label={t.title} className="flex flex-wrap gap-2">
        {sections.map(([key, label]) => (
          <a
            key={key}
            href={`#${key}`}
            className="flex min-h-11 items-center rounded-full border-2 border-border px-4 font-semibold hover:bg-surface-alt"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="overview" title={t.sections.overview}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="customer-stats">
          <Stat label={t.stats.pulledUp} value={v.stats.pulledUp} />
          <Stat label={t.stats.checkedIn} value={v.stats.checkedIn} />
          <Stat label={t.stats.upcoming} value={v.stats.upcoming} />
          <Stat label={t.stats.hosted} value={v.stats.hosted} />
          <Stat label={t.stats.noShows} value={v.stats.noShows} />
          <Stat label={t.stats.lateCancels} value={v.stats.lateCancels} />
          <Stat label={t.stats.hostRating} value={rating(v.hostRating)} />
          <Stat label={t.stats.ratingsGiven} value={rating(v.ratingsGiven)} />
        </div>
        <div className="admin-card">
          <Fields
            rows={[
              ...(v.access === 'full'
                ? ([
                    [t.fields.phone, v.phone ?? t.notSet],
                    [t.fields.email, v.email ?? t.notSet],
                  ] as [string, ReactNode][])
                : ([
                    [
                      t.fields.phone,
                      v.user.phoneLast4
                        ? en.admin.phoneEnding.replace('{{last4}}', v.user.phoneLast4)
                        : t.notSet,
                    ],
                  ] as [string, ReactNode][])),
              [t.fields.joined, when(v.user.createdAt)],
              [t.fields.onboarded, when(v.onboardedAt)],
              [t.fields.lastActive, when(v.lastActiveAt)],
              [t.fields.age, p.age ?? t.notSet],
              [t.fields.gender, p.gender ? en.onboarding.genders[p.gender] : t.notSet],
              [t.fields.city, [p.neighbourhood, p.city].filter(Boolean).join(', ') || t.notSet],
              [t.fields.languages, p.spokenLanguages.join(', ') || t.notSet],
              [t.fields.appLanguage, en.settings.languageNames[p.appLanguage]],
              [t.fields.interests, p.interests.join(', ') || t.notSet],
              [t.fields.bio, p.bio || t.notSet],
              [
                t.fields.invitedBy,
                v.invitedBy ? (
                  <>
                    <Person id={v.invitedBy.id} name={v.invitedBy.name} />
                    {v.invitedAt ? ` · ${istDate.format(new Date(v.invitedAt))}` : ''}
                  </>
                ) : (
                  t.fields.invitedByUs
                ),
              ],
              [
                en.profile.reliability,
                v.reliability.cooldownUntil
                  ? `${en.profile.tiers[v.reliability.tier]} · ${fill(t.stats.cooldownUntil, { date: when(v.reliability.cooldownUntil) })}`
                  : en.profile.tiers[v.reliability.tier],
              ],
              ...(v.roles.length > 0
                ? ([[t.fields.roles, v.roles.join(', ')]] as [string, ReactNode][])
                : []),
            ]}
          />
        </div>
      </Section>

      <Section id="plans" title={t.sections.plans}>
        {v.plans.length === 0 ? (
          <p className="text-muted">{t.none}</p>
        ) : (
          <div className="admin-card overflow-x-auto p-0">
            <table className="w-full min-w-[40rem] text-left" data-testid="customer-plans">
              <thead>
                <tr className="border-b-2 border-border">
                  <th scope="col" className="p-3">
                    {t.plan.plan}
                  </th>
                  <th scope="col" className="p-3">
                    {t.plan.when}
                  </th>
                  <th scope="col" className="p-3">
                    {t.plan.role}
                  </th>
                  <th scope="col" className="p-3">
                    {t.plan.status}
                  </th>
                  <th scope="col" className="p-3">
                    {t.plan.rating}
                  </th>
                  {v.access === 'full' ? (
                    <th scope="col" className="p-3">
                      {t.plan.paid}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {v.plans.map((plan) => (
                  <tr key={plan.eventId} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <Link
                        href={`/admin/events/${plan.eventId}`}
                        className="font-semibold underline"
                      >
                        {plan.title}
                      </Link>
                      {plan.cityName ? (
                        <span className="block text-sm text-muted">{plan.cityName}</span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {new Intl.DateTimeFormat('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: plan.timezone,
                      }).format(new Date(plan.startsAt))}
                    </td>
                    <td className="p-3">{t.roles[plan.role]}</td>
                    <td className="p-3">{planStatus(plan)}</td>
                    <td className="p-3">
                      {plan.ratingGiven === null ? '—' : `${String(plan.ratingGiven)}/5`}
                    </td>
                    {v.access === 'full' ? (
                      <td className="p-3">
                        {plan.paidPaise === null ? '—' : money(plan.paidPaise)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {v.spend ? (
        <Section id="spending" title={t.sections.spending}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="customer-spend">
            <Stat label={t.spend.paid} value={money(v.spend.paidPaise)} />
            <Stat label={t.spend.refunded} value={money(v.spend.refundedPaise)} />
            <Stat label={t.spend.payments} value={v.spend.payments} />
            <Stat label={t.spend.hostEarned} value={money(v.spend.hostEarnedPaise)} />
            <Stat
              label={t.spend.lastPaid}
              value={<span className="text-base">{when(v.spend.lastPaidAt)}</span>}
            />
            <Stat label={t.spend.passes} value={v.spend.priorityPasses} />
            <Stat label={t.spend.credits} value={v.spend.credits} />
          </div>
        </Section>
      ) : null}

      <Section id="social" title={t.sections.social}>
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label={t.social.squad} value={v.social.squad} />
          <div className="admin-card flex flex-col gap-2">
            <h3 className="font-bold">{t.social.crews}</h3>
            {v.social.crews.length === 0 ? <p className="text-sm text-muted">{t.none}</p> : null}
            <ul className="flex flex-col gap-1">
              {v.social.crews.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          </div>
          <div className="admin-card flex flex-col gap-2" data-testid="customer-invitees">
            <h3 className="font-bold">
              {t.social.invitees} ({v.invitees.length})
            </h3>
            {v.invitees.length === 0 ? <p className="text-sm text-muted">{t.none}</p> : null}
            <ul className="flex flex-col gap-1">
              {v.invitees.map((i) => (
                <li key={i.id}>
                  <Person id={i.id} name={i.name} />{' '}
                  <span className="text-sm text-muted">{istDate.format(new Date(i.at))}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {v.safety ? (
        <Section id="safety" title={t.sections.safety}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="customer-safety">
            <Stat label={t.safety.reportsAgainst} value={v.safety.reportsAgainst} />
            <Stat label={t.safety.reportsMade} value={v.safety.reportsMade} />
            <Stat label={t.safety.sos} value={v.safety.sosCount} />
            <Stat label={t.safety.trustedContacts} value={v.safety.trustedContacts} />
          </div>
          {v.safety.mutedUntil ? (
            <p>{fill(t.safety.muted, { date: when(v.safety.mutedUntil) })}</p>
          ) : null}
          {v.safety.suspendedUntil ? (
            <p>{fill(t.safety.suspended, { date: when(v.safety.suspendedUntil) })}</p>
          ) : null}
          <div className="admin-card flex flex-col gap-2">
            <h3 className="font-bold">{t.safety.sanctions}</h3>
            {v.safety.sanctions.length === 0 ? (
              <p className="text-sm text-muted">{t.none}</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {v.safety.sanctions.map((s) => (
                <li key={s.id}>
                  <span className="font-semibold">{en.admin.sanctions[s.kind]}</span> ·{' '}
                  {when(s.createdAt)} · {s.reason}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}

      <Section id="timeline" title={t.sections.timeline}>
        <ol className="admin-card flex flex-col gap-3" data-testid="customer-timeline">
          {v.timeline.map((item, i) => (
            <li
              key={`${item.at}-${item.kind}-${String(i)}`}
              className="flex flex-col gap-0.5 border-l-4 border-primary pl-3"
            >
              <span className="text-sm text-muted">{when(item.at)}</span>
              <span>
                {item.personId &&
                (item.kind === 'invited_by' || item.kind === 'invited_someone') ? (
                  <Link href={`/admin/customers/${item.personId}`} className="underline">
                    {timelineText(item)}
                  </Link>
                ) : item.eventId ? (
                  <Link href={`/admin/events/${item.eventId}`} className="underline">
                    {timelineText(item)}
                  </Link>
                ) : (
                  timelineText(item)
                )}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
