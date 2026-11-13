'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const DAY = 86_400_000;
const istDay = (ms: number): string => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
const label = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** Time slider (D-193): drag to see the network as it stood on any day since the first person joined. */
export function TimeSlider({
  first,
  until,
  root,
  all,
  text,
}: {
  first: string;
  until: string | null;
  root: string | null;
  all: boolean;
  text: { until: string; untilValue: string; today: string };
}) {
  const router = useRouter();
  const start = Date.parse(`${istDay(Date.parse(first))}T00:00:00+05:30`);
  const end = Date.parse(`${istDay(Date.now())}T00:00:00+05:30`);
  const days = Math.max(0, Math.round((end - start) / DAY));
  const initial = until ? Math.round((Date.parse(`${until}T00:00:00+05:30`) - start) / DAY) : days;
  const [value, setValue] = useState(Math.min(days, Math.max(0, initial)));
  const at = start + value * DAY;
  const go = (v: number): void => {
    const q = new URLSearchParams();
    if (v < days) q.set('until', istDay(start + v * DAY));
    if (root) q.set('root', root);
    if (all) q.set('all', '1');
    const qs = q.toString();
    router.push(qs ? `/admin/network?${qs}` : '/admin/network');
  };
  const shown = text.untilValue.replace('{{date}}', label.format(new Date(at)));
  return (
    <div className="admin-card flex flex-col gap-2">
      <label htmlFor="network-until" className="font-semibold">
        {text.until}:{' '}
        <span data-testid="network-until-label">{value >= days ? text.today : shown}</span>
      </label>
      <input
        id="network-until"
        type="range"
        min={0}
        max={days}
        step={1}
        value={value}
        aria-valuetext={value >= days ? text.today : shown}
        onChange={(e) => {
          setValue(Number(e.target.value));
        }}
        onPointerUp={() => {
          go(value);
        }}
        onKeyUp={() => {
          go(value);
        }}
        className="min-h-11 w-full accent-[var(--tg-primary)]"
      />
    </div>
  );
}
