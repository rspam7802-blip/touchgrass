import { describe, expect, it } from 'vitest';
import { buildIcs, icsDate, icsEscape, icsFold } from './ics';

describe('iCalendar writer (F-CAL-01)', () => {
  it('escapes text and formats UTC dates', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(icsDate(new Date('2026-11-08T00:30:00.000Z'))).toBe('20261108T003000Z');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'క'.repeat(40)}`;
    const folded = icsFold(line);
    for (const part of folded.split('\r\n'))
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(icsFold('short')).toBe('short');
  });

  it('writes a subscribable calendar with updates and cancellations', () => {
    const ics = buildIcs({
      name: 'TouchGrass plans',
      refreshMinutes: 60,
      events: [
        {
          uid: 'e1@touchgrass.app',
          sequence: 3,
          start: new Date('2026-11-08T00:30:00Z'),
          end: new Date('2026-11-08T02:00:00Z'),
          updatedAt: new Date('2026-11-02T10:00:00Z'),
          title: 'Sunday run, KBR',
          description: 'Bring water',
          location: 'KBR Park',
          url: 'https://touchgrass.app/e/abc',
        },
        {
          uid: 'e2@touchgrass.app',
          sequence: 0,
          start: new Date('2026-11-09T12:00:00Z'),
          end: new Date('2026-11-09T14:00:00Z'),
          updatedAt: new Date('2026-11-02T10:00:00Z'),
          title: 'Board games',
          status: 'CANCELLED',
        },
      ],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('SUMMARY:Sunday run\\, KBR');
    expect(ics).toContain('SEQUENCE:3');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT60M');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(buildIcs({ name: 'x', events: [] })).not.toContain('REFRESH-INTERVAL');
  });
});
