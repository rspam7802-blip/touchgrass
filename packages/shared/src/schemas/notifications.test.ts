import { describe, expect, it } from 'vitest';
import { ClientAnalyticsBody, MarkNotificationsReadBody, QuietHours } from './notifications';

const ID = '7b6f1c1e-6a3c-4d7a-9b1e-2f3c4d5e6f70';

describe('notification, calendar and analytics schemas', () => {
  it('marks either some notifications or all of them', () => {
    expect(MarkNotificationsReadBody.safeParse({ ids: [ID] }).success).toBe(true);
    expect(MarkNotificationsReadBody.safeParse({ all: true }).success).toBe(true);
    expect(MarkNotificationsReadBody.safeParse({}).success).toBe(false);
    expect(MarkNotificationsReadBody.safeParse({ ids: [ID], all: true }).success).toBe(false);
  });

  it('quiet hours use HH:MM', () => {
    expect(QuietHours.safeParse({ enabled: true, start: '22:00', end: '07:30' }).success).toBe(
      true,
    );
    expect(QuietHours.safeParse({ enabled: true, start: '10pm', end: '07:30' }).success).toBe(
      false,
    );
  });

  it('client analytics only takes known events and simple property names', () => {
    expect(
      ClientAnalyticsBody.parse({
        events: [{ name: 'share_tapped', properties: { target: 'event' } }],
      }).events[0]?.properties,
    ).toEqual({ target: 'event' });
    expect(ClientAnalyticsBody.safeParse({ events: [{ name: 'login_with_phone' }] }).success).toBe(
      false,
    );
    expect(
      ClientAnalyticsBody.safeParse({
        events: [{ name: 'app_opened', properties: { 'Bad Key': 1 } }],
      }).success,
    ).toBe(false);
    expect(ClientAnalyticsBody.safeParse({ events: [] }).success).toBe(false);
  });
});
