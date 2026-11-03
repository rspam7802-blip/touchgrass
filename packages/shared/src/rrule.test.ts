import { describe, expect, it } from 'vitest';
import { buildRRule, isValidRRule, parseRRule, rruleOccurrences } from './rrule';

// Sunday 1 Nov 2026, 06:00 IST.
const START = new Date('2026-11-01T00:30:00.000Z');
const istDay = (d: Date): string =>
  new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ');
const days = (dates: Date[]): string[] => dates.map(istDay);

describe('parseRRule', () => {
  it('reads the supported parts', () => {
    expect(parseRRule('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1SU,-1FR;COUNT=6')).toEqual({
      freq: 'MONTHLY',
      interval: 2,
      byDay: [
        { weekday: 7, ordinal: 1 },
        { weekday: 5, ordinal: -1 },
      ],
      count: 6,
      until: null,
    });
    expect(parseRRule('freq=weekly;byday=sa').byDay).toEqual([{ weekday: 6, ordinal: null }]);
  });

  it.each([
    ['', 'empty'],
    ['FREQ=YEARLY', 'FREQ must be'],
    ['FREQ=WEEKLY;BYHOUR=9', 'not supported'],
    ['FREQ=WEEKLY;BYDAY=1SU', 'ordinals only'],
    ['FREQ=MONTHLY;BYDAY=6SU', 'ordinal must be'],
    ['FREQ=WEEKLY;COUNT=3;UNTIL=20261231', 'not both'],
    ['FREQ=WEEKLY;FREQ=DAILY', 'repeated'],
    ['FREQ=WEEKLY;INTERVAL=0', 'INTERVAL must be 1'],
    ['FREQ=WEEKLY;INTERVAL=x', 'INTERVAL must be a number'],
    ['FREQ=WEEKLY;COUNT=0', 'COUNT must be 1'],
    ['FREQ=WEEKLY;COUNT=abc', 'COUNT must be a number'],
    ['FREQ=WEEKLY;BYDAY=XX', 'bad BYDAY'],
    ['FREQ=WEEKLY;BYDAY=MO,MO', 'repeated'],
    ['FREQ=WEEKLY;UNTIL=2026', 'UNTIL must be'],
    ['FREQ', 'bad part'],
    [`FREQ=WEEKLY;${'X'.repeat(200)}`, 'too long'],
  ])('rejects %s', (rule, message) => {
    expect(() => parseRRule(rule)).toThrow(message);
    expect(isValidRRule(rule)).toBe(false);
  });
});

describe('rruleOccurrences (IST)', () => {
  const nov = { from: START, to: new Date('2026-12-01T00:00:00.000Z') };

  it('weekly keeps the time of day from the start', () => {
    expect(days(rruleOccurrences('FREQ=WEEKLY', START, nov.from, nov.to))).toEqual([
      '2026-11-01 06:00',
      '2026-11-08 06:00',
      '2026-11-15 06:00',
      '2026-11-22 06:00',
      '2026-11-29 06:00',
    ]);
  });

  it('every other week on two days, never before the start', () => {
    expect(
      days(rruleOccurrences('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,SU', START, nov.from, nov.to)),
    ).toEqual([
      '2026-11-01 06:00',
      '2026-11-14 06:00',
      '2026-11-15 06:00',
      '2026-11-28 06:00',
      '2026-11-29 06:00',
    ]);
  });

  it('monthly on the first Sunday and the last Friday', () => {
    const to = new Date('2027-01-01T00:00:00.000Z');
    expect(days(rruleOccurrences('FREQ=MONTHLY;BYDAY=1SU,-1FR', START, START, to))).toEqual([
      '2026-11-01 06:00',
      '2026-11-27 06:00',
      '2026-12-06 06:00',
      '2026-12-25 06:00',
    ]);
  });

  it('monthly by date skips months without that day', () => {
    const jan31 = new Date('2027-01-31T13:30:00.000Z'); // 19:00 IST
    const out = rruleOccurrences('FREQ=MONTHLY', jan31, jan31, new Date('2027-06-01T00:00:00Z'));
    expect(days(out)).toEqual(['2027-01-31 19:00', '2027-03-31 19:00', '2027-05-31 19:00']);
  });

  it('daily with an interval and a weekday filter', () => {
    const out = rruleOccurrences(
      'FREQ=DAILY;INTERVAL=3;BYDAY=MO,TU,WE,TH,FR',
      START,
      START,
      new Date('2026-11-12T00:00:00Z'),
    );
    // 1 (Sun, filtered), 4 Wed, 7 Sat (filtered), 10 Tue.
    expect(days(out)).toEqual(['2026-11-04 06:00', '2026-11-10 06:00']);
  });

  it('COUNT counts from the start even when the window starts later', () => {
    const from = new Date('2026-11-10T00:00:00Z');
    expect(days(rruleOccurrences('FREQ=WEEKLY;COUNT=3', START, from, nov.to))).toEqual([
      '2026-11-15 06:00',
    ]);
  });

  it('a date-only UNTIL includes that whole day; a timestamp is exact', () => {
    expect(rruleOccurrences('FREQ=WEEKLY;UNTIL=20261115', START, START, nov.to)).toHaveLength(3);
    expect(
      rruleOccurrences('FREQ=WEEKLY;UNTIL=20261115T003000Z', START, START, nov.to),
    ).toHaveLength(3);
    expect(
      rruleOccurrences('FREQ=WEEKLY;UNTIL=20261115T002959Z', START, START, nov.to),
    ).toHaveLength(2);
  });

  it('respects the limit and accepts a parsed rule', () => {
    expect(rruleOccurrences(parseRRule('FREQ=DAILY'), START, START, nov.to, 4)).toHaveLength(4);
  });
});

describe('buildRRule', () => {
  it('builds what the app pickers describe', () => {
    expect(buildRRule({ freq: 'WEEKLY', weekdays: ['SU'] })).toBe('FREQ=WEEKLY;BYDAY=SU');
    expect(buildRRule({ freq: 'WEEKLY', interval: 2, weekdays: ['SA', 'SU'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,SU',
    );
    expect(buildRRule({ freq: 'MONTHLY', weekdays: ['FR'], ordinal: -1, count: 10 })).toBe(
      'FREQ=MONTHLY;BYDAY=-1FR;COUNT=10',
    );
    expect(buildRRule({ freq: 'DAILY' })).toBe('FREQ=DAILY');
    expect(() => buildRRule({ freq: 'WEEKLY', weekdays: ['SU'], ordinal: 1 })).not.toThrow();
  });
});
