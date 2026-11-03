import { LOCALE_DEFAULTS } from './constants';
/**
 * Minimal RFC 5545 writer for plan calendars (F-CAL-01): one VEVENT per plan, stable UIDs and SEQUENCE so
 * calendar apps apply edits, `STATUS:CANCELLED` for cancelled plans. Times are written in UTC.
 */
export interface IcsEvent {
  uid: string;
  /** Bumps whenever the plan changes, so subscribed calendars replace their copy. */
  sequence: number;
  start: Date;
  end: Date;
  updatedAt: Date;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
}

export interface IcsCalendar {
  name: string;
  events: IcsEvent[];
  /** How often subscribers should refresh. */
  refreshMinutes?: number;
  /** Display zone hint for calendar apps (times themselves are UTC); defaults to IST. */
  timezone?: string;
}

/** Escapes TEXT values (backslash, semicolon, comma, newlines). */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** `20261108T003000Z` */
export function icsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Folds a content line to 75 octets per line (continuations start with a space), never splitting a character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(cal: IcsCalendar): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TouchGrass//Plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(cal.name)}`,
    `X-WR-TIMEZONE:${cal.timezone ?? LOCALE_DEFAULTS.timezone}`,
  ];
  if (cal.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${String(cal.refreshMinutes)}M`);
    lines.push(`X-PUBLISHED-TTL:PT${String(cal.refreshMinutes)}M`);
  }
  for (const e of cal.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `SEQUENCE:${String(e.sequence)}`,
      `DTSTAMP:${icsDate(e.updatedAt)}`,
      `LAST-MODIFIED:${icsDate(e.updatedAt)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      `STATUS:${e.status ?? 'CONFIRMED'}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}
