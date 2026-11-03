/**
 * The subset of RFC 5545 recurrence rules crews use (F-ENG-02), evaluated in IST (UTC+05:30, no DST):
 * FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY (weekdays; MONTHLY also takes ordinals such as 1SU or -1FR),
 * COUNT and UNTIL. The time of day comes from DTSTART. Anything else is rejected, so a rule either means
 * exactly what the app shows or is refused.
 */

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];
export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RRuleDay {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** MONTHLY only: 1..5 for "first".."fifth", -1..-5 counting from the end; null = every such weekday. */
  ordinal: number | null;
}

export interface ParsedRRule {
  freq: RRuleFreq;
  interval: number;
  byDay: RRuleDay[];
  count: number | null;
  until: Date | null;
}

const MAX_INTERVAL = 12;
const MAX_COUNT = 500;
/** Safety bound on how far a single expansion walks (10 years of days). */
const MAX_SCAN_DAYS = 3660;

function fail(message: string): never {
  throw new RangeError(`Invalid recurrence rule: ${message}`);
}

function parseUntil(v: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(v);
  if (!m) fail('UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) {
    // A date-only UNTIL includes that whole IST day.
    return new Date(Date.UTC(y, mo - 1, d + 1) - IST_OFFSET_MS - 1);
  }
  return new Date(Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6])));
}

export function parseRRule(rule: string): ParsedRRule {
  const text = rule.trim().replace(/^RRULE:/i, '');
  if (text.length === 0 || text.length > 200) fail('empty or too long');
  const seen = new Map<string, string>();
  for (const part of text.split(';')) {
    const [key, value, extra] = part.split('=');
    if (!key || value === undefined || extra !== undefined || value.length === 0)
      fail(`bad part "${part}"`);
    const k = key.toUpperCase();
    if (seen.has(k)) fail(`${k} repeated`);
    seen.set(k, value.toUpperCase());
  }
  for (const k of seen.keys())
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL'].includes(k)) fail(`${k} is not supported`);
  const freq = seen.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY')
    fail('FREQ must be DAILY, WEEKLY or MONTHLY');
  const intervalRaw = seen.get('INTERVAL') ?? '1';
  if (!/^\d{1,2}$/.test(intervalRaw)) fail('INTERVAL must be a number');
  const interval = Number(intervalRaw);
  if (interval < 1 || interval > MAX_INTERVAL) fail(`INTERVAL must be 1–${String(MAX_INTERVAL)}`);
  const countRaw = seen.get('COUNT');
  let count: number | null = null;
  if (countRaw !== undefined) {
    if (!/^\d{1,3}$/.test(countRaw)) fail('COUNT must be a number');
    count = Number(countRaw);
    if (count < 1 || count > MAX_COUNT) fail(`COUNT must be 1–${String(MAX_COUNT)}`);
  }
  const untilRaw = seen.get('UNTIL');
  const until = untilRaw === undefined ? null : parseUntil(untilRaw);
  if (count !== null && until !== null) fail('use COUNT or UNTIL, not both');
  const byDay: RRuleDay[] = [];
  const byDayRaw = seen.get('BYDAY');
  if (byDayRaw !== undefined) {
    for (const token of byDayRaw.split(',')) {
      const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token);
      if (!m) fail(`bad BYDAY "${token}"`);
      const ordinal = m[1] === undefined ? null : Number(m[1]);
      if (ordinal !== null) {
        if (freq !== 'MONTHLY') fail('BYDAY ordinals only work with FREQ=MONTHLY');
        if (ordinal === 0 || ordinal < -5 || ordinal > 5)
          fail('BYDAY ordinal must be 1–5 or -1–-5');
      }
      const weekday = WEEKDAY_CODES.indexOf(m[2] as WeekdayCode) + 1;
      if (byDay.some((d) => d.weekday === weekday && d.ordinal === ordinal))
        fail(`${token} repeated`);
      byDay.push({ weekday, ordinal });
    }
  }
  return { freq, interval, byDay, count, until };
}

/** True when `rule` parses. */
export function isValidRRule(rule: string): boolean {
  try {
    parseRRule(rule);
    return true;
  } catch {
    return false;
  }
}

/** IST calendar parts of an instant. */
function local(d: Date): {
  y: number;
  m: number;
  day: number;
  weekday: number;
  dayIndex: number;
  ms: number;
} {
  const shifted = d.getTime() + IST_OFFSET_MS;
  const dayIndex = Math.floor(shifted / DAY_MS);
  const ld = new Date(shifted);
  const jsDay = ld.getUTCDay();
  return {
    y: ld.getUTCFullYear(),
    m: ld.getUTCMonth(),
    day: ld.getUTCDate(),
    weekday: jsDay === 0 ? 7 : jsDay,
    dayIndex,
    ms: shifted - dayIndex * DAY_MS,
  };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

function matchesMonthly(
  rule: ParsedRRule,
  start: ReturnType<typeof local>,
  d: ReturnType<typeof local>,
): boolean {
  if (rule.byDay.length === 0) return d.day === start.day;
  return rule.byDay.some((b) => {
    if (b.weekday !== d.weekday) return false;
    if (b.ordinal === null) return true;
    if (b.ordinal > 0) return Math.ceil(d.day / 7) === b.ordinal;
    const fromEnd = Math.ceil((daysInMonth(d.y, d.m) - d.day + 1) / 7);
    return -fromEnd === b.ordinal;
  });
}

function matches(
  rule: ParsedRRule,
  start: ReturnType<typeof local>,
  d: ReturnType<typeof local>,
): boolean {
  switch (rule.freq) {
    case 'DAILY':
      return (
        (d.dayIndex - start.dayIndex) % rule.interval === 0 &&
        (rule.byDay.length === 0 || rule.byDay.some((b) => b.weekday === d.weekday))
      );
    case 'WEEKLY': {
      // Weeks start on Monday (WKST=MO); day index 0 (1970-01-01) was a Thursday.
      const weekOf = (x: ReturnType<typeof local>) => Math.floor((x.dayIndex + 3) / 7);
      if ((weekOf(d) - weekOf(start)) % rule.interval !== 0) return false;
      return rule.byDay.length === 0
        ? d.weekday === start.weekday
        : rule.byDay.some((b) => b.weekday === d.weekday);
    }
    case 'MONTHLY': {
      const months = (d.y - start.y) * 12 + (d.m - start.m);
      return months % rule.interval === 0 && matchesMonthly(rule, start, d);
    }
  }
}

/**
 * Occurrences of `rule` starting at `dtstart` that fall in [from, to), at most `limit`. COUNT counts from
 * DTSTART, so earlier occurrences still use up the count.
 */
export function rruleOccurrences(
  rule: string | ParsedRRule,
  dtstart: Date,
  from: Date,
  to: Date,
  limit = 100,
): Date[] {
  const r = typeof rule === 'string' ? parseRRule(rule) : rule;
  const start = local(dtstart);
  const out: Date[] = [];
  let seen = 0;
  const lastDay = local(new Date(to.getTime() - 1)).dayIndex;
  for (let di = start.dayIndex; di <= lastDay && di - start.dayIndex <= MAX_SCAN_DAYS; di += 1) {
    const at = new Date(di * DAY_MS + start.ms - IST_OFFSET_MS);
    if (at < dtstart) continue;
    if (r.until && at > r.until) break;
    const d = local(at);
    if (!matches(r, start, d)) continue;
    seen += 1;
    if (r.count !== null && seen > r.count) break;
    if (at >= from && at < to) {
      out.push(at);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Builds a rule string from the app's simple pickers (weekly on some days, or monthly on the nth weekday). */
export function buildRRule(input: {
  freq: RRuleFreq;
  interval?: number;
  weekdays?: WeekdayCode[];
  ordinal?: number | null;
  count?: number | null;
}): string {
  const parts = [`FREQ=${input.freq}`];
  if (input.interval && input.interval > 1) parts.push(`INTERVAL=${String(input.interval)}`);
  if (input.weekdays && input.weekdays.length > 0) {
    const prefix = input.freq === 'MONTHLY' && input.ordinal ? String(input.ordinal) : '';
    parts.push(`BYDAY=${input.weekdays.map((w) => `${prefix}${w}`).join(',')}`);
  }
  if (input.count) parts.push(`COUNT=${String(input.count)}`);
  const built = parts.join(';');
  parseRRule(built);
  return built;
}

export { WEEKDAY_CODES };
