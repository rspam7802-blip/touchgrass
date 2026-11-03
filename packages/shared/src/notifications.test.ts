import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from './constants';
import { flattenKeys, resources } from './i18n';
import {
  DEFAULT_QUIET_WINDOW,
  fillParams,
  formatClock,
  inQuietWindow,
  isNotificationKind,
  NOTIFICATION_KINDS,
  NOTIFICATION_TEMPLATES,
  notificationTemplate,
  parseClock,
  quietWindowEnd,
  renderNotification,
  translate,
} from './notifications';

describe('notification templates (F-NOT-01)', () => {
  it('every title and body key exists in every language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const keys = flattenKeys(resources[lang]);
      for (const kind of NOTIFICATION_KINDS) {
        const t = notificationTemplate(kind);
        expect(keys[t.title], `${lang} ${kind} title`).toBeTruthy();
        expect(keys[t.body], `${lang} ${kind} body`).toBeTruthy();
      }
    }
  });

  it('links are in-app paths without a scheme', () => {
    for (const t of Object.values(NOTIFICATION_TEMPLATES))
      expect(t.link).toMatch(/^[a-z][a-z/{}A-Za-z-]*$/);
    expect(isNotificationKind('reminder_soon')).toBe(true);
    expect(isNotificationKind('nope')).toBe(false);
  });

  it('renders in the reader’s language with every kind of parameter', () => {
    const params = {
      title: 'Sunset run',
      until: { at: '2026-11-08T13:30:00.000Z' },
      eventId: 'e1',
    };
    const en = renderNotification('waitlist_offer', params, 'en');
    expect(en).toEqual({
      title: 'A spot opened up at Sunset run',
      body: 'Claim it before Sun, 8 Nov, 7:00 pm.',
      path: 'events/e1',
    });
    const hi = renderNotification('waitlist_offer', params, 'hi');
    expect(hi.title).toContain('Sunset run');
    expect(hi.body).not.toBe(en.body);
    const te = renderNotification(
      'verification_rejected',
      { reason: { t: 'verification.rejectReasons.UNCLEAR' } },
      'te',
    );
    expect(te.body).toContain(resources.te.verification.rejectReasons.UNCLEAR);
    const localized = renderNotification(
      'challenge_completed',
      { title: { en: 'Café crawl', te: 'కేఫ్ క్రాల్', hi: 'कैफ़े क्रॉल' } },
      'te',
    );
    expect(localized.title).toContain('కేఫ్ క్రాల్');
    expect(renderNotification('streak_risk', { count: 4 }, 'en').body).toContain('4-week');
  });

  it('uses admin wording when given and the plan’s zone for moments', () => {
    const params = {
      title: 'Sunset run',
      until: { at: '2026-11-08T13:30:00.000Z', tz: 'Asia/Dubai' },
      eventId: 'e1',
    };
    const custom = renderNotification('waitlist_offer', params, 'en', {
      title: 'Seat free: {{title}}',
      body: 'Grab it by {{until}}',
    });
    expect(custom).toEqual({
      title: 'Seat free: Sunset run',
      body: 'Grab it by Sun, 8 Nov, 5:30 pm',
      path: 'events/e1',
    });
    expect(renderNotification('waitlist_offer', params, 'en', null).title).toBe(
      'A spot opened up at Sunset run',
    );
    expect(renderNotification('city_launched', { city: 'Vizag' }, 'en').path).toBe('city');
  });

  it('fills missing parameters with nothing and ignores formatter suffixes', () => {
    expect(fillParams('{{a}}-{{b, istDate}}', { b: 'x' }, 'en')).toBe('-x');
    expect(translate('no.such.key', 'en')).toBe('no.such.key');
    expect(translate('brand.name', 'te')).toBe(resources.te.brand.name);
  });
});

describe('quiet hours', () => {
  const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m) - 330 * 60_000);

  it('parses and formats clock times', () => {
    expect(parseClock('22:30')).toBe(1350);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('7:00')).toBeNull();
    expect(formatClock(1350)).toBe('22:30');
    expect(formatClock(0)).toBe('00:00');
  });

  it('wraps past midnight by default (22:00–08:00 IST)', () => {
    expect(inQuietWindow(ist(23), DEFAULT_QUIET_WINDOW)).toBe(true);
    expect(inQuietWindow(ist(3), DEFAULT_QUIET_WINDOW)).toBe(true);
    expect(inQuietWindow(ist(8), DEFAULT_QUIET_WINDOW)).toBe(false);
    expect(inQuietWindow(ist(21, 59), DEFAULT_QUIET_WINDOW)).toBe(false);
    expect(quietWindowEnd(ist(23, 15), DEFAULT_QUIET_WINDOW).toISOString()).toBe(
      ist(32).toISOString(),
    );
    expect(quietWindowEnd(ist(12), DEFAULT_QUIET_WINDOW)).toEqual(ist(12));
  });

  it('handles same-day windows, an empty window and switching off', () => {
    const lunch = { enabled: true, start: 13 * 60, end: 14 * 60 };
    expect(inQuietWindow(ist(13, 30), lunch)).toBe(true);
    expect(inQuietWindow(ist(14), lunch)).toBe(false);
    expect(quietWindowEnd(ist(13, 30), lunch).toISOString()).toBe(ist(14).toISOString());
    expect(inQuietWindow(ist(23), { ...DEFAULT_QUIET_WINDOW, enabled: false })).toBe(false);
    expect(inQuietWindow(ist(23), { enabled: true, start: 60, end: 60 })).toBe(false);
  });
});
