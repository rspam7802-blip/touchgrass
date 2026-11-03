import { LIMITS, LOCALE_DEFAULTS } from './constants';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date: Date, timeZone: string = LOCALE_DEFAULTS.timezone): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 1,
  };
}

/** Quiet hours are 22:00–08:00 in the user's timezone (IST by default). */
export function isQuietHours(date: Date, timeZone: string = LOCALE_DEFAULTS.timezone): boolean {
  const { hour } = zonedParts(date, timeZone);
  const { quietHoursStart, quietHoursEnd } = LIMITS.notifications;
  return hour >= quietHoursStart || hour < quietHoursEnd;
}

/** ISO-8601 week key such as "2026-W44", computed in the given timezone. Used for weekly streaks. */
export function isoWeekKey(date: Date, timeZone: string = LOCALE_DEFAULTS.timezone): string {
  const { year, month, day, weekday } = zonedParts(date, timeZone);
  const local = Date.UTC(year, month - 1, day);
  const thursday = new Date(local + (4 - weekday) * 86_400_000);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Whole years between a date of birth (YYYY-MM-DD) and `now`, evaluated in IST. */
export function ageInYears(dateOfBirth: string, now: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) throw new RangeError('dateOfBirth must be YYYY-MM-DD');
  const [by, bm, bd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const { year, month, day } = zonedParts(now);
  let age = year - by;
  if (month < bm || (month === bm && day < bd)) age -= 1;
  return age;
}

export function isAdult(dateOfBirth: string, now: Date = new Date()): boolean {
  return ageInYears(dateOfBirth, now) >= LIMITS.minAgeYears;
}
