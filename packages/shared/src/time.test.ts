import { describe, expect, it } from 'vitest';
import { ageInYears, isAdult, isoWeekKey, isQuietHours, zonedParts } from './time';

describe('time (IST)', () => {
  it('derives IST wall-clock parts', () => {
    // 2026-10-31T18:30Z is 2026-11-01 00:00 IST (a Sunday)
    expect(zonedParts(new Date('2026-10-31T18:30:00Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 1,
      hour: 0,
      minute: 0,
      weekday: 7,
    });
  });
  it('detects quiet hours 22:00–08:00 IST', () => {
    expect(isQuietHours(new Date('2026-10-31T16:30:00Z'))).toBe(true); // 22:00 IST
    expect(isQuietHours(new Date('2026-10-31T02:29:00Z'))).toBe(true); // 07:59 IST
    expect(isQuietHours(new Date('2026-10-31T02:30:00Z'))).toBe(false); // 08:00 IST
    expect(isQuietHours(new Date('2026-10-31T16:29:00Z'))).toBe(false); // 21:59 IST
  });
  it('computes ISO week keys in IST, including year boundaries', () => {
    expect(isoWeekKey(new Date('2026-10-31T06:00:00Z'))).toBe('2026-W44');
    expect(isoWeekKey(new Date('2026-11-01T18:29:00Z'))).toBe('2026-W44'); // Sun 23:59 IST
    expect(isoWeekKey(new Date('2026-11-01T18:30:00Z'))).toBe('2026-W45'); // Mon 00:00 IST
    expect(isoWeekKey(new Date('2027-01-01T06:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2025-12-29T06:00:00Z'))).toBe('2026-W01');
  });
  it('enforces the 18+ age gate on the birthday boundary', () => {
    const now = new Date('2026-10-31T06:00:00Z');
    expect(ageInYears('2008-10-31', now)).toBe(18);
    expect(isAdult('2008-10-31', now)).toBe(true);
    expect(isAdult('2008-11-01', now)).toBe(false);
    expect(ageInYears('2000-01-15', now)).toBe(26);
    expect(() => ageInYears('31/10/2008', now)).toThrow(RangeError);
  });
});
