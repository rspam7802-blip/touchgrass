'use client';

import {
  LIMITS,
  localeTag,
  PublicLiveView,
  type SupportedLanguage,
  type Translation,
} from '@touchgrass/shared';
import { useEffect, useState } from 'react';

const POLL_MS = 15_000;

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** A small OpenStreetMap window around the point (≈1 km across). */
function embedUrl(lat: number, lng: number): string {
  const d = 0.006;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((n) => n.toFixed(5)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/** Shows the latest position and keeps it fresh while sharing is on; stops polling once it ends. */
export function LiveClient({
  token,
  initial,
  t,
  language,
}: {
  token: string;
  initial: PublicLiveView;
  t: Translation['safety']['viewer'];
  language: SupportedLanguage;
}) {
  const [view, setView] = useState<PublicLiveView | null>(initial);
  const active = view?.status === 'active';

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      void fetch(`/l/${token}/data`, { cache: 'no-store' })
        .then(async (res) => {
          if (res.status === 404) setView(null);
          else if (res.ok) setView(PublicLiveView.parse(await res.json()));
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [active, token]);

  const time = (iso: string): string =>
    new Intl.DateTimeFormat(localeTag(language), {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));

  if (!view)
    return (
      <h1 className="text-3xl font-extrabold" data-testid="live-not-found">
        {t.notFound}
      </h1>
    );
  if (!active)
    return (
      <section className="flex flex-col gap-3" data-testid="live-ended">
        <h1 className="text-3xl font-extrabold">{fill(t.ended, { name: view.name })}</h1>
        <p>{t.endedBody}</p>
        <p className="text-sm text-muted">{t.privacy}</p>
      </section>
    );

  const p = view.lastPoint;
  const emergency = LIMITS.safety.emergencyNumber;
  return (
    <section className="flex flex-col gap-4" data-testid="live-active">
      {view.sos ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-2xl border-4 border-[var(--tg-danger)] p-4"
          data-testid="live-sos"
        >
          <p className="text-2xl font-extrabold">{fill(t.sos, { name: view.name })}</p>
          <p>{t.sosBody}</p>
          <a
            href={`tel:${emergency}`}
            className="flex min-h-11 items-center self-start rounded-full bg-primary px-6 font-bold text-on-primary"
          >
            {t.call112}
          </a>
        </div>
      ) : null}
      <h1 className="text-3xl font-extrabold">{fill(t.title, { name: view.name })}</h1>
      <p>{fill(t.until, { time: time(view.expiresAt) })}</p>
      {p ? (
        <>
          <iframe
            title={fill(t.map, { name: view.name })}
            src={embedUrl(p.lat, p.lng)}
            className="h-80 w-full rounded-2xl border-2 border-border"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <p aria-live="polite" data-testid="live-last-seen">
            {fill(t.lastSeen, { time: time(p.at) })}
            {p.accuracy !== null
              ? ` · ${fill(t.accuracy, { meters: Math.round(p.accuracy) })}`
              : ''}
          </p>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`}
            rel="noopener noreferrer"
            target="_blank"
            className="flex min-h-11 items-center self-start rounded-full bg-primary px-6 font-bold text-on-primary"
          >
            {t.openMaps}
          </a>
        </>
      ) : (
        <p aria-live="polite" data-testid="live-waiting">
          {t.waiting}
        </p>
      )}
      {view.event ? (
        <section
          className="flex flex-col gap-1 rounded-2xl border-2 border-border p-4"
          data-testid="live-event"
        >
          <h2 className="text-lg font-bold">{t.plan}</h2>
          <p className="font-semibold">{view.event.title}</p>
          <p>
            {fill(t.planTime, { start: time(view.event.startsAt), end: time(view.event.endsAt) })}
          </p>
          {view.event.place ? <p>{view.event.place}</p> : null}
        </section>
      ) : null}
      <p className="text-sm text-muted">{t.autoRefresh}</p>
      <p className="text-sm text-muted">{t.privacy}</p>
    </section>
  );
}
