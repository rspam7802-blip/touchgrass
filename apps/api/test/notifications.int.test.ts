import type {
  CalendarFeed,
  CrewDetail,
  NotificationPage,
  PublicCrewView,
  PublicProfileView,
  QuietHours,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePushSender } from '../src/adapters/push/fake.push.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { toAnalytics } from '../src/modules/analytics/analytics.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { RemindersHandlers } from '../src/modules/reminders/reminders.handlers.js';
import { RemindersService } from '../src/modules/reminders/reminders.service.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { idem, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  fromIp,
  type Harness,
  interestIds,
  member,
  type Member,
} from './harness.js';

let h: Harness;
const push = new FakePushSender();
const H = 3_600_000;
const MIN = 60_000;

beforeAll(async () => {
  h = await createHarness({ push });
});
afterAll(async () => {
  await h.close();
});

const api = (m: Member) => ({
  get: (path: string) =>
    request(h.http)
      .get(path)
      .set(...bearer(m.token)),
  post: (path: string, body?: object) =>
    request(h.http)
      .post(path)
      .set(...bearer(m.token))
      .set(...idem())
      .send(body ?? {}),
  put: (path: string, body: object) =>
    request(h.http)
      .put(path)
      .set(...bearer(m.token))
      .send(body),
  patch: (path: string, body: object) =>
    request(h.http)
      .patch(path)
      .set(...bearer(m.token))
      .send(body),
});

let tokenSeq = 0;
async function withDevice(m: Member): Promise<string> {
  tokenSeq += 1;
  const token = `ExponentPushToken[n${String(tokenSeq)}-${m.id.slice(0, 8)}]`;
  await api(m).post('/v1/me/devices', { expoPushToken: token, platform: 'android' }).expect(204);
  return token;
}
const pushesTo = (token: string, since = 0) => push.sent.slice(since).filter((p) => p.to === token);
const quietOff = (m: Member) =>
  api(m)
    .put('/v1/me/settings/quiet-hours', { enabled: false, start: '22:00', end: '08:00' })
    .expect(200);
const inbox = async (m: Member): Promise<NotificationPage> =>
  (await api(m).get('/v1/notifications?limit=50').expect(200)).body as NotificationPage;

/** Replays outbox rows of these types for an aggregate through the reminder/notification handlers. */
async function drain(types: string[], aggregateId: string): Promise<void> {
  const { rows } = await h.pool.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    'SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = ANY($2) ORDER BY created_at',
    [aggregateId, types],
  );
  const bus = new DomainEventBus();
  h.app.get(RemindersHandlers).registerOn(bus);
  for (const r of rows)
    await bus.dispatch({
      eventId: r.id,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      type: r.event_type,
      payload: r.payload,
      occurredAt: r.created_at.toISOString(),
    });
}

/** Current minute of the day in IST. */
function istMinute(at: Date): number {
  const ist = new Date(at.getTime() + 330 * MIN);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
const clock = (m: number): string => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

// ---------- F-NOT-01 ----------

describe('notification engine (F-NOT-01)', () => {
  it('writes an inbox item and pushes it with a deep link; the inbox reads in your language', async () => {
    const a = await member(h);
    await quietOff(a);
    const token = await withDevice(a);
    const before = push.sent.length;
    const res = await h.app.get(NotificationsService).notify([a.id], 'event_host_added', {
      title: 'Sunday run',
      eventId: '01890a5d-ac96-774b-bcce-b302099a8057',
      when: { at: '2026-11-08T00:30:00.000Z' },
    });
    expect(res).toEqual({ inbox: 1, pushed: 1, deferred: 0 });
    const [sent] = pushesTo(token, before);
    expect(sent).toMatchObject({
      title: "You're co-hosting Sunday run",
      body: 'Sun, 8 Nov, 6:00 am',
      data: { url: 'touchgrass://events/01890a5d-ac96-774b-bcce-b302099a8057' },
      channelId: 'event_updates',
    });
    const page = await inbox(a);
    expect(page.unread).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: sent?.data?.notificationId,
      kind: 'event_host_added',
      title: "You're co-hosting Sunday run",
      read: false,
    });

    await api(a)
      .put('/v1/me/settings/language', { language: 'te' })
      .expect((r) => {
        expect([200, 204]).toContain(r.status);
      });
    const te = await inbox(a);
    expect(te.items[0]?.title).toBe('నువ్వు Sunday runకి కో-హోస్ట్');

    expect(
      (
        await api(a)
          .post('/v1/notifications/read', { ids: [te.items[0]?.id] })
          .expect(200)
      ).body,
    ).toEqual({
      unread: 0,
    });
    await api(a).post('/v1/notifications/read', {}).expect(400);
    expect((await api(a).get('/v1/notifications/unread').expect(200)).body).toEqual({ unread: 0 });
  });

  it('honours per-category choices: no inbox item when in-app is off, no push when push is off', async () => {
    const a = await member(h);
    await quietOff(a);
    const token = await withDevice(a);
    await api(a)
      .put('/v1/me/settings/notifications', {
        items: [{ category: 'event_updates', push: false, inApp: false }],
      })
      .expect(200);
    const before = push.sent.length;
    const res = await h.app
      .get(NotificationsService)
      .notify([a.id], 'event_cancelled', { title: 'Board games', eventId: a.id });
    expect(res).toEqual({ inbox: 0, pushed: 0, deferred: 0 });
    expect(pushesTo(token, before)).toHaveLength(0);
    expect((await inbox(a)).items).toHaveLength(0);
  });

  it('quiet hours hold non-urgent pushes until they end; urgent ones go straight through', async () => {
    const a = await member(h);
    const token = await withDevice(a);
    const now = new Date();
    const m = istMinute(now);
    const quiet = (
      await api(a)
        .put('/v1/me/settings/quiet-hours', {
          enabled: true,
          start: clock(m - 30),
          end: clock(m + 30),
        })
        .expect(200)
    ).body as QuietHours;
    expect(quiet).toEqual({ enabled: true, start: clock(m - 30), end: clock(m + 30) });
    await api(a)
      .put('/v1/me/settings/quiet-hours', { enabled: true, start: '9pm', end: '07:00' })
      .expect(400);

    const n = h.app.get(NotificationsService);
    const before = push.sent.length;
    expect(
      await n.notify(
        [a.id],
        'event_invited',
        { name: 'Kiran', title: 'Biryani crawl', eventId: a.id },
        { now },
      ),
    ).toMatchObject({ pushed: 0, deferred: 1, inbox: 1 });
    expect(
      await n.notify(
        [a.id],
        'waitlist_offer',
        { title: 'Biryani crawl', eventId: a.id, until: { at: now.toISOString() } },
        { now },
      ),
    ).toMatchObject({ pushed: 1, deferred: 0 });
    expect(pushesTo(token, before).map((p) => p.title)).toEqual([
      'A spot opened up at Biryani crawl',
    ]);

    await n.flushPending(new Date(now.getTime() + 5 * MIN));
    expect(pushesTo(token, before)).toHaveLength(1);
    const { rows } = await h.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pending_pushes WHERE user_id = $1',
      [a.id],
    );
    expect(rows[0]?.n).toBe(1);
    await n.flushPending(new Date(now.getTime() + 31 * MIN));
    expect(pushesTo(token, before).map((p) => p.title)).toEqual([
      'A spot opened up at Biryani crawl',
      'Kiran invited you to Biryani crawl',
    ]);
  });

  it('low-priority pushes are batched; several become one digest, repeats of one thing collapse', async () => {
    const a = await member(h);
    await quietOff(a);
    const token = await withDevice(a);
    const n = h.app.get(NotificationsService);
    const now = new Date();
    const before = push.sent.length;
    await n.notify([a.id], 'free_now', { name: 'Kiran' }, { now, collapseKey: 'free-k' });
    await n.notify([a.id], 'free_now', { name: 'Kiran' }, { now, collapseKey: 'free-k' });
    expect(pushesTo(token, before)).toHaveLength(0);
    await n.flushPending(new Date(now.getTime() + 11 * MIN));
    expect(pushesTo(token, before).map((p) => p.title)).toEqual(['Kiran is free now']);

    const mark = push.sent.length;
    await n.notify([a.id], 'free_now', { name: 'Kiran' }, { now });
    await n.notify([a.id], 'friend_requested', { name: 'Meera' }, { now });
    await n.flushPending(new Date(now.getTime() + 11 * MIN));
    const digest = pushesTo(token, mark);
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({
      title: '2 new updates',
      body: 'Kiran is free now and more',
      data: { url: 'touchgrass://notifications' },
    });
    expect((await inbox(a)).items).toHaveLength(4);
  });
});

// ---------- F-NOT-02 + F-EVT-16 ----------

describe('reminders and activity notifications (F-NOT-02, F-EVT-16)', () => {
  it('squad requests and acceptances notify the other person', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    await drain(['friendship.requested', 'friendship.accepted'], a.id);
    await drain(['friendship.requested', 'friendship.accepted'], b.id);
    expect((await inbox(b)).items.map((i) => i.kind)).toContain('friend_requested');
    const accepted = (await inbox(a)).items.find((i) => i.kind === 'friend_accepted');
    expect(accepted).toMatchObject({
      title: 'Test Person is in your squad now',
      url: `touchgrass://users/${b.id}`,
    });
  });

  it('plan edits and cancellations reach everyone with a seat, never the person who made them', async () => {
    const host = await verifiedMember(h);
    const b = await member(h);
    const event = await plot(h, host);
    await rsvp(h, b, event.id).expect(200);
    await api(host)
      .patch(`/v1/events/${event.id}`, {
        startsAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 4 * 86_400_000 + 2 * H).toISOString(),
      })
      .expect(200);
    await drain(['event.updated'], event.id);
    expect((await inbox(b)).items.map((i) => i.kind)).toContain('event_updated');
    await api(host).post(`/v1/events/${event.id}/cancel`, { reason: 'Rain' }).expect(200);
    await drain(['event.cancelled'], event.id);
    const cancelled = (await inbox(b)).items.find((i) => i.kind === 'event_cancelled');
    expect(cancelled).toMatchObject({
      title: 'Sunset frisbee is cancelled',
      url: `touchgrass://events/${event.id}`,
    });
    expect(
      (await inbox(host)).items.some(
        (i) => i.kind === 'event_cancelled' || i.kind === 'event_updated',
      ),
    ).toBe(false);
  });

  it('day and two-hour reminders go once each; mystery reveals and the after-plan ask follow', async () => {
    const host = await verifiedMember(h);
    const b = await member(h);
    const event = await plot(h, host, { mystery: true, mysteryRevealMinutesBefore: 120 });
    await rsvp(h, b, event.id).expect(200);
    const r = h.app.get(RemindersService);
    await shiftEvent(h, event.id, 5 * H);
    expect(await r.remindPlans()).toBeGreaterThanOrEqual(2);
    expect(await r.remindPlans()).toBe(0);
    const day = (await inbox(b)).items.find((i) => i.kind === 'reminder_day');
    expect(day?.title).toBe('Sunset frisbee is coming up');
    expect(day?.body).toMatch(/^Starts .+\. The group chat is now open\.$/);

    await shiftEvent(h, event.id, 90 * MIN);
    await r.remindPlans();
    expect((await inbox(b)).items.filter((i) => i.kind === 'reminder_soon')).toHaveLength(1);
    expect(await r.announceReveals()).toBeGreaterThanOrEqual(2);
    expect(await r.announceReveals()).toBe(0);
    const revealed = (await inbox(b)).items.find((i) => i.kind === 'mystery_revealed');
    expect(JSON.stringify(revealed)).not.toContain('Secret Garden');

    await h.pool.query(
      "UPDATE rsvps SET status = 'checked_in', checked_in_at = now() WHERE event_id = $1 AND user_id = $2",
      [event.id, b.id],
    );
    expect(await r.askFeedback(event.id)).toBe(1);
    expect(await r.askFeedback(event.id)).toBe(0);
    expect((await inbox(b)).items.find((i) => i.kind === 'feedback_ask')).toMatchObject({
      url: `touchgrass://after/${event.id}`,
    });
    expect(await r.prune(new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThanOrEqual(4);
  });

  it('the inbox is cleared of items older than 90 days', async () => {
    const a = await member(h);
    await h.app
      .get(NotificationsService)
      .notify([a.id], 'feedback_ask', { title: 'Old plan', eventId: a.id });
    await h.pool.query(
      "UPDATE notifications SET created_at = now() - interval '91 days' WHERE user_id = $1",
      [a.id],
    );
    expect(await h.app.get(NotificationsService).purgeOld()).toBeGreaterThanOrEqual(1);
    expect((await inbox(a)).items).toHaveLength(0);
  });
});

// ---------- F-CAL-01 ----------

describe('calendar sync (F-CAL-01)', () => {
  it('a private feed lists your plans mystery-safely, follows cancellations and can be reset', async () => {
    const host = await verifiedMember(h);
    const b = await member(h);
    const open = await plot(h, host, { title: 'Open mic night' });
    const mystery = await plot(h, host, { title: 'Mystery dinner', mystery: true });
    const dropped = await plot(h, host, { title: 'Dropped picnic' });
    for (const e of [open, mystery, dropped]) await rsvp(h, b, e.id).expect(200);
    await api(host).post(`/v1/events/${dropped.id}/cancel`, { reason: '' }).expect(200);

    const feed = (await api(b).get('/v1/me/calendar').expect(200)).body as CalendarFeed;
    expect(feed.webcalUrl.startsWith('webcal:')).toBe(true);
    const path = new URL(feed.url).pathname;
    const res = await request(h.http)
      .get(path)
      .set(...fromIp())
      .expect(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    const ics = res.text;
    expect(ics).toContain('SUMMARY:Open mic night');
    expect(ics).toContain('LOCATION:The Hidden Courtyard\\, 42 Secret Garden Lane\\, Gachibowli');
    expect(ics).toContain('SUMMARY:Mystery dinner');
    const mysteryBlock = ics.slice(ics.indexOf('SUMMARY:Mystery dinner'));
    expect(mysteryBlock.slice(0, mysteryBlock.indexOf('END:VEVENT'))).toContain(
      'Mystery spot near',
    );
    expect(ics.split('BEGIN:VEVENT').find((v) => v.includes('Dropped picnic'))).toContain(
      'STATUS:CANCELLED',
    );
    expect(ics).not.toContain('Secret Garden Lane, Gachibowli\\nMystery');

    const reset = (await api(b).post('/v1/me/calendar/reset').expect(200)).body as CalendarFeed;
    expect(reset.url).not.toBe(feed.url);
    await request(h.http)
      .get(path)
      .set(...fromIp())
      .expect(404);
    await request(h.http)
      .get(new URL(reset.url).pathname)
      .set(...fromIp())
      .expect(200);
    const [uid, version] = new URL(reset.url).pathname.split('/').at(-1)?.split('.') ?? [];
    await request(h.http)
      .get(`/v1/calendar/${uid ?? ''}.${version ?? ''}.${'A'.repeat(43)}.ics`)
      .set(...fromIp())
      .expect(404);
    await request(h.http)
      .get('/v1/calendar/nope.ics')
      .set(...fromIp())
      .expect(400);

    const one = await api(b).get(`/v1/events/${open.id}/calendar.ics`).expect(200);
    expect(one.headers['content-type']).toContain('text/calendar');
    expect(one.text).toContain(`UID:${open.id}@touchgrass.app`);
    const stranger = await member(h);
    await api(stranger).get(`/v1/events/${mystery.id}/calendar.ics`).expect(200);
  });
});

// ---------- F-GRW-02, F-PLT-05 ----------

describe('share pages and analytics (F-GRW-02, F-PLT-05)', () => {
  it('shared profile and crew links show only what strangers may see', async () => {
    const a = await member(h);
    const pub = (
      await request(h.http)
        .get(`/v1/public/users/${a.id}`)
        .set(...fromIp())
        .expect(200)
    ).body as PublicProfileView;
    expect(pub).toMatchObject({ id: a.id, displayName: 'Test Person', verified: false });
    expect(pub.photo?.md).toBeTruthy();
    await api(a).put('/v1/me/settings/privacy', { profileVisibility: 'squad_only' }).expect(200);
    const hidden = (
      await request(h.http)
        .get(`/v1/public/users/${a.id}`)
        .set(...fromIp())
        .expect(200)
    ).body as PublicProfileView;
    expect(hidden.photo).toBeNull();
    await request(h.http)
      .get('/v1/public/users/01890a5d-ac96-774b-bcce-b302099a8057')
      .set(...fromIp())
      .expect(404);

    const [interestId] = await interestIds(h, 1);
    const crew = (
      await api(a)
        .post('/v1/crews', { name: 'Lakeside walkers', description: 'Slow walks', interestId })
        .expect(201)
    ).body as CrewDetail;
    expect(
      (
        await request(h.http)
          .get(`/v1/public/crews/${crew.id}`)
          .set(...fromIp())
          .expect(200)
      ).body as PublicCrewView,
    ).toMatchObject({ name: 'Lakeside walkers', memberCount: 1 });
    const closed = (
      await api(a)
        .post('/v1/crews', {
          name: 'Private table',
          description: '',
          interestId,
          joinPolicy: 'invite_only',
        })
        .expect(201)
    ).body as CrewDetail;
    await request(h.http)
      .get(`/v1/public/crews/${closed.id}`)
      .set(...fromIp())
      .expect(404);
  });

  it('the app can report allow-listed events without personal data', async () => {
    const a = await member(h);
    expect(
      (
        await api(a)
          .post('/v1/analytics/events', {
            events: [{ name: 'share_tapped', properties: { target: 'event' } }],
          })
          .expect(202)
      ).body,
    ).toEqual({ accepted: 1 });
    await api(a)
      .post('/v1/analytics/events', { events: [{ name: 'checked_phone' }] })
      .expect(400);
    await api(a)
      .post('/v1/analytics/events', {
        events: [{ name: 'app_opened', properties: { phone_hint: 'x' } }],
      })
      .expect(400);
    await api(a)
      .post('/v1/analytics/events', {
        events: [{ name: 'app_opened', properties: { ref: '+91 98765 43210' } }],
      })
      .expect(400);
  });

  it('domain events map to analytics with only ids and small enums', () => {
    const base = {
      eventId: '01890a5d-ac96-774b-bcce-b302099a8057',
      aggregateType: 'event',
      aggregateId: '01890a5d-ac96-774b-bcce-b302099a8058',
      occurredAt: new Date().toISOString(),
    };
    expect(
      toAnalytics({
        ...base,
        type: 'event.created',
        payload: { creatorUserId: 'u1', visibility: 'public', cityId: 'c' },
      }),
    ).toEqual({ distinctId: 'u1', event: 'plan_created', properties: { visibility: 'public' } });
    expect(
      toAnalytics({ ...base, aggregateType: 'user', type: 'user.onboarded', payload: {} })
        ?.distinctId,
    ).toBe(base.aggregateId);
    expect(toAnalytics({ ...base, type: 'lore.changed', payload: {} })).toBeNull();
    expect(toAnalytics({ ...base, type: 'event.created', payload: {} })).toBeNull();
  });
});

describe('notification data in export and erase (DPDP)', () => {
  it('inbox and quiet hours are exported, then erased with the account', async () => {
    const a = await member(h);
    await api(a)
      .put('/v1/me/settings/quiet-hours', { enabled: true, start: '23:00', end: '07:00' })
      .expect(200);
    await h.app
      .get(NotificationsService)
      .notify([a.id], 'feedback_ask', { title: 'Export plan', eventId: a.id });
    await api(a).get('/v1/me/calendar').expect(200);
    const text = JSON.stringify((await api(a).get('/v1/me/export').expect(200)).body);
    expect(text).toContain('"quietHours"');
    expect(text).toContain('feedback_ask');

    await api(a).post('/v1/me/deletion', { confirm: 'DELETE' }).expect(202);
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
      [a.id],
    );
    await h.app.get(AccountService).purgeDue();
    const { rows } = await h.pool.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM notifications WHERE user_id = $1) AS inbox,
              (SELECT count(*)::int FROM notification_settings WHERE user_id = $1) AS quiet,
              (SELECT count(*)::int FROM calendar_feeds WHERE user_id = $1) AS feeds`,
      [a.id],
    );
    expect(rows[0]).toEqual({ inbox: 0, quiet: 0, feeds: 0 });
  });
});
