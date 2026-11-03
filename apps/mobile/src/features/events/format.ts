import type { EventLocationView, EventSummary } from '@touchgrass/shared';
import { composeDate } from '../me/dob';

type T = (key: string, opts?: Record<string, unknown>) => string;

/** IST has no daylight saving: a fixed +05:30 offset. */
const IST_OFFSET_MS = 330 * 60_000;

/** "DD/MM/YYYY" + "HH:MM" entered in IST → ISO instant, or null if either is invalid. */
export function istToIso(date: string, time: string): string | null {
  const [d = '', m = '', y = ''] = date.split('/');
  const ymd = composeDate(d, m, y);
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!ymd || !match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return null;
  const [yy, mo, dd] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(yy, mo - 1, dd, hh, mm) - IST_OFFSET_MS).toISOString();
}

/** ISO instant → { date: "DD/MM/YYYY", time: "HH:MM" } in IST (for editing). */
export function isoToIst(iso: string): { date: string; time: string } {
  const ist = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${String(ist.getUTCFullYear())}`,
    time: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`,
  };
}

/** Quick picks for the "when" step, as IST date/time strings. */
export function quickPick(
  kind: 'tonight' | 'tomorrow' | 'weekend',
  now: Date = new Date(),
): { date: string; time: string } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  let hour = 19;
  if (kind === 'tonight') {
    // Too late for 7 pm? Next full hour (still tonight).
    if (ist.getUTCHours() >= 19) hour = Math.min(ist.getUTCHours() + 1, 23);
  } else if (kind === 'tomorrow') {
    day.setUTCDate(day.getUTCDate() + 1);
    hour = 18;
  } else {
    day.setUTCDate(day.getUTCDate() + ((6 - day.getUTCDay() + 7) % 7));
    hour = 17;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${pad(day.getUTCDate())}/${pad(day.getUTCMonth() + 1)}/${String(day.getUTCFullYear())}`,
    time: `${pad(hour)}:00`,
  };
}

/** Plan times show in the plan's city zone (pass `event.timezone`); everything else in IST. */
export function formatWhen(iso: string, language: string, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat(`${language}-IN`, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string, language: string, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat(`${language}-IN`, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** One line describing where — never more than the API chose to reveal. */
export function locationLabel(t: T, location: EventLocationView): string {
  if (location.kind === 'exact')
    return location.placeName ? `${location.placeName} · ${location.address}` : location.address;
  return t('events.mysteryArea', { area: location.neighbourhoodName ?? 'Hyderabad' });
}

export function capacityLabel(
  t: T,
  e: Pick<EventSummary, 'goingCount' | 'spotsLeft' | 'waitlistCount'>,
): string {
  const parts = [t('events.going', { count: e.goingCount })];
  parts.push(e.spotsLeft > 0 ? t('events.spotsLeft', { count: e.spotsLeft }) : t('events.full'));
  if (e.waitlistCount > 0) parts.push(t('events.waitlist', { count: e.waitlistCount }));
  return parts.join(' · ');
}

export function rsvpLabel(t: T, e: Pick<EventSummary, 'status' | 'viewer'>): string | null {
  if (e.status === 'cancelled') return t('events.cancelled');
  if (e.status === 'completed') return t('events.ended');
  if (e.viewer.isHost) return t('events.reasons.HOST');
  switch (e.viewer.rsvp) {
    case 'going':
      return t('events.youreGoing');
    case 'checked_in':
      return t('events.checkedIn');
    case 'interested':
      return t('events.youreInterested');
    case 'waitlisted':
      return t('events.waitlisted');
    case 'held':
      return t('payments.status.created');
    default:
      return null;
  }
}
