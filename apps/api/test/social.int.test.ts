import { hashPhoneE164 } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service.js';
import { ActivityHandlers } from '../src/modules/social/activity/activity.handlers.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { SEED_ADMIN_PHONE } from '../src/seed/seed.js';
import {
  bearer,
  befriend,
  createHarness,
  type Harness,
  interestIds,
  member,
  type Member,
  signIn,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const idem = (): [string, string] => [
  'Idempotency-Key',
  `k-${Date.now()}-${Math.random().toString(36).slice(2)}`,
];
const sendRequest = (from: Member, to: Member | string) =>
  request(h.http)
    .post('/v1/social/requests')
    .set(...bearer(from.token))
    .set(...idem())
    .send({ userId: typeof to === 'string' ? to : to.id });
const profileOf = (viewer: Member, target: Member) =>
  request(h.http)
    .get(`/v1/users/${target.id}/profile`)
    .set(...bearer(viewer.token));

/** Runs the worker's domain-event handlers over every outbox row (twice, to prove idempotency). */
async function drainOutbox(): Promise<void> {
  const bus = new DomainEventBus();
  h.app.get(ActivityHandlers).registerOn(bus);
  const { rows } = await h.pool.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    "SELECT * FROM outbox_events WHERE event_type IN ('friendship.accepted', 'user.onboarded') ORDER BY created_at",
  );
  for (let pass = 0; pass < 2; pass += 1) {
    for (const r of rows) {
      await bus.dispatch({
        eventId: r.id,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        type: r.event_type,
        payload: r.payload,
        occurredAt: r.created_at.toISOString(),
      });
    }
  }
}

describe('squad requests (F-SOC-02)', () => {
  it('request → incoming list → accept → squad on both sides and on profiles', async () => {
    const [a, b] = [await member(h), await member(h)];
    expect((await sendRequest(a, b).expect(200)).body).toEqual({ relationship: 'request_sent' });
    expect((await sendRequest(a, b).expect(200)).body).toEqual({ relationship: 'request_sent' });
    const incoming = await request(h.http)
      .get('/v1/social/requests')
      .set(...bearer(b.token))
      .expect(200);
    expect(incoming.body.items).toEqual([
      expect.objectContaining({
        direction: 'incoming',
        person: expect.objectContaining({ id: a.id }) as object,
      }),
    ]);
    expect((await profileOf(b, a).expect(200)).body.relationship).toBe('request_received');
    expect((await profileOf(a, b).expect(200)).body.relationship).toBe('request_sent');

    await request(h.http)
      .post(`/v1/social/requests/${a.id}/accept`)
      .set(...bearer(b.token))
      .expect(200, { relationship: 'squad' });
    for (const [viewer, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const squad = await request(h.http)
        .get('/v1/social/squad')
        .set(...bearer(viewer.token))
        .expect(200);
      expect(squad.body.items.map((p: { id: string }) => p.id)).toEqual([other.id]);
      expect((await profileOf(viewer, other).expect(200)).body.relationship).toBe('squad');
    }
    await request(h.http)
      .post(`/v1/social/requests/${a.id}/accept`)
      .set(...bearer(b.token))
      .expect(404);
  });

  it('two people asking each other become squad (mutual pull), even concurrently', async () => {
    const [a, b] = [await member(h), await member(h)];
    const [r1, r2] = await Promise.all([sendRequest(a, b), sendRequest(b, a)]);
    expect([r1.body.relationship, r2.body.relationship].sort()).toEqual(['request_sent', 'squad']);
    const { rows } = await h.pool.query(
      'SELECT status FROM friendships WHERE user_low = LEAST($1::uuid, $2::uuid) AND user_high = GREATEST($1::uuid, $2::uuid)',
      [a.id, b.id],
    );
    expect(rows).toEqual([{ status: 'accepted' }]);
  });

  it('declines are silent and cannot be re-spammed; cancel and remove work', async () => {
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    await sendRequest(a, b).expect(200);
    await request(h.http)
      .post(`/v1/social/requests/${a.id}/decline`)
      .set(...bearer(b.token))
      .expect(200, { relationship: 'none' });
    expect((await sendRequest(a, b).expect(200)).body.relationship).toBe('request_sent');
    expect(
      (
        await request(h.http)
          .get('/v1/social/requests')
          .set(...bearer(b.token))
      ).body.items,
    ).toEqual([]);
    expect((await profileOf(a, b)).body.relationship).toBe('none');

    await sendRequest(a, c).expect(200);
    await request(h.http)
      .delete(`/v1/social/requests/${c.id}`)
      .set(...bearer(a.token))
      .expect(204);
    await request(h.http)
      .delete(`/v1/social/requests/${c.id}`)
      .set(...bearer(a.token))
      .expect(404);
    await befriend(h, a, c);
    await request(h.http)
      .delete(`/v1/social/squad/${c.id}`)
      .set(...bearer(a.token))
      .expect(204);
    expect(
      (
        await request(h.http)
          .get('/v1/social/squad')
          .set(...bearer(c.token))
      ).body.items,
    ).toEqual([]);
    await request(h.http)
      .delete(`/v1/social/squad/${c.id}`)
      .set(...bearer(a.token))
      .expect(404);
  });

  it('rejects self, unknown and malformed targets', async () => {
    const a = await member(h);
    await sendRequest(a, a).expect(400);
    await request(h.http)
      .post('/v1/social/requests')
      .set(...bearer(a.token))
      .set(...idem())
      .send({ userId: 'nope' })
      .expect(400);
    await request(h.http)
      .post('/v1/social/requests')
      .set(...bearer(a.token))
      .send({ userId: a.id })
      .expect(400);
  });

  it('paginates the squad with cursors', async () => {
    const hub = await member(h);
    const friends = [await member(h), await member(h), await member(h)];
    for (const f of friends) await befriend(h, f, hub);
    const p1 = await request(h.http)
      .get('/v1/social/squad?limit=2')
      .set(...bearer(hub.token))
      .expect(200);
    const p2 = await request(h.http)
      .get(`/v1/social/squad?limit=2&cursor=${p1.body.nextCursor as string}`)
      .set(...bearer(hub.token))
      .expect(200);
    const ids = [...p1.body.items, ...p2.body.items].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(3);
    expect(p2.body.nextCursor).toBeNull();
  });
});

describe('mutual friends and friends-of-friends', () => {
  it('counts mutuals and opens friends-of-friends profiles', async () => {
    const [a, b, c] = [
      await member(h),
      await member(h, { displayName: 'Bridge Person' }),
      await member(h, { bio: 'fof-only bio' }),
    ];
    await befriend(h, a, b);
    await befriend(h, b, c);
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(c.token))
      .send({ profileVisibility: 'friends_of_friends' })
      .expect(200);
    const res = await profileOf(a, c).expect(200);
    expect(res.body).toMatchObject({
      limited: false,
      bio: 'fof-only bio',
      mutualFriends: { count: 1, sample: [{ id: b.id, displayName: 'Bridge Person' }] },
    });
    const stranger = await member(h);
    expect((await profileOf(stranger, c).expect(200)).body.limited).toBe(true);
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(c.token))
      .send({ profileVisibility: 'squad_only' })
      .expect(200);
    expect((await profileOf(a, c).expect(200)).body.limited).toBe(true);
    expect((await profileOf(b, c).expect(200)).body.limited).toBe(false);
  });
});

describe('blocking hides both people everywhere (F-SOC-05)', () => {
  it('ends the friendship, hides profiles and requests both ways, and can be undone', async () => {
    const [a, b, c] = [
      await member(h),
      await member(h, { displayName: 'Blocked Person' }),
      await member(h),
    ];
    await befriend(h, a, b);
    await befriend(h, b, c);
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(a.token))
      .send({ userId: b.id })
      .expect(204);

    await profileOf(a, b).expect(404);
    await profileOf(b, a).expect(404);
    await sendRequest(b, a).expect(404);
    await sendRequest(a, b).expect(404);
    expect(
      (
        await request(h.http)
          .get('/v1/social/squad')
          .set(...bearer(a.token))
      ).body.items,
    ).toEqual([]);
    const blocked = await request(h.http)
      .get('/v1/social/blocks')
      .set(...bearer(a.token))
      .expect(200);
    expect(blocked.body.items).toEqual([
      expect.objectContaining({ id: b.id, displayName: 'Blocked Person' }),
    ]);
    // Blocked people never appear as someone's mutual friend.
    const viaC = await profileOf(a, c).expect(200);
    expect(viaC.body.mutualFriends.count).toBe(0);
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(a.token))
      .send({ userId: a.id })
      .expect(400);

    await request(h.http)
      .delete(`/v1/social/blocks/${b.id}`)
      .set(...bearer(a.token))
      .expect(204);
    await request(h.http)
      .delete(`/v1/social/blocks/${b.id}`)
      .set(...bearer(a.token))
      .expect(404);
    expect((await profileOf(a, b).expect(200)).body.relationship).toBe('none');
  });
});

describe('contacts (F-SOC-01)', () => {
  it('matches only hashed numbers of discoverable, unblocked members', async () => {
    const [me, friend, hidden, blockedOne] = [
      await member(h),
      await member(h, { displayName: 'Contact Friend' }),
      await member(h),
      await member(h),
    ];
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(hidden.token))
      .send({ discoverableByContacts: false })
      .expect(200);
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(me.token))
      .send({ userId: blockedOne.id })
      .expect(204);
    const hashes = [friend.phone, hidden.phone, blockedOne.phone, me.phone, '+919999988888'].map(
      hashPhoneE164,
    );
    const res = await request(h.http)
      .post('/v1/social/contacts/match')
      .set(...bearer(me.token))
      .send({ hashes })
      .expect(200);
    expect(res.body.items).toEqual([
      {
        hash: hashPhoneE164(friend.phone),
        person: expect.objectContaining({ id: friend.id, displayName: 'Contact Friend' }) as object,
        relationship: 'none',
      },
    ]);
    const { rows } = await h.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM contact_hashes WHERE user_id = $1',
      [me.id],
    );
    expect(rows[0]?.n).toBe(5);
    await request(h.http)
      .post('/v1/social/contacts/match')
      .set(...bearer(me.token))
      .send({ hashes: [hashPhoneE164(friend.phone)] })
      .expect(200);
    expect(
      (
        await h.pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM contact_hashes WHERE user_id = $1',
          [me.id],
        )
      ).rows[0]?.n,
    ).toBe(1);
  });

  it('accepts hashes only, never raw numbers', async () => {
    const me = await member(h);
    const raw = await request(h.http)
      .post('/v1/social/contacts/match')
      .set(...bearer(me.token))
      .send({ hashes: ['+919848022338'] })
      .expect(400);
    expect(raw.body.error.code).toBe('VALIDATION_FAILED');
    await request(h.http)
      .post('/v1/social/contacts/match')
      .set(...bearer(me.token))
      .send({ hashes: [] })
      .expect(400);
  });
});

describe('suggestions (F-SOC-02, F-SOC-03)', () => {
  it('ranks friends-of-friends and contacts, never shows squad/pending/blocked/dismissed', async () => {
    const [me, f1, f2, fof, fan, rando] = [
      await member(h),
      await member(h),
      await member(h),
      await member(h),
      await member(h),
      await member(h),
    ];
    await befriend(h, me, f1);
    await befriend(h, me, f2);
    await befriend(h, f1, fof);
    await befriend(h, f2, fof);
    // `fan` has my number in their contacts: I should see them as someone I may know.
    await request(h.http)
      .post('/v1/social/contacts/match')
      .set(...bearer(fan.token))
      .send({ hashes: [hashPhoneE164(me.phone)] })
      .expect(200);
    const res = await request(h.http)
      .get('/v1/social/suggestions')
      .set(...bearer(me.token))
      .expect(200);
    const byId = new Map(
      (res.body.items as { person: { id: string }; reasons: string[]; score: number }[]).map(
        (s) => [s.person.id, s],
      ),
    );
    expect(byId.get(fof.id)?.reasons).toContain('mutual_friends');
    expect(byId.get(fan.id)?.reasons).toContain('contact');
    for (const excluded of [me.id, f1.id, f2.id]) expect(byId.has(excluded)).toBe(false);
    expect(res.body.items[0].score).toBeGreaterThanOrEqual(
      res.body.items[res.body.items.length - 1].score,
    );

    await request(h.http)
      .post(`/v1/social/suggestions/${fof.id}/dismiss`)
      .set(...bearer(me.token))
      .expect(204);
    await sendRequest(me, fan).expect(200);
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(me.token))
      .send({ userId: rando.id })
      .expect(204);
    const after = await request(h.http)
      .get('/v1/social/suggestions')
      .set(...bearer(me.token))
      .expect(200);
    const ids = after.body.items.map((s: { person: { id: string } }) => s.person.id);
    for (const gone of [fof.id, fan.id, rando.id]) expect(ids).not.toContain(gone);
  });

  it('interest-only suggestions need at least two shared interests (no random matching)', async () => {
    const [ids3] = [await interestIds(h, 33)];
    const me = await member(h);
    const twin = await member(h);
    await request(h.http)
      .put('/v1/me/interests')
      .set(...bearer(me.token))
      .send({ interestIds: ids3.slice(30, 33) })
      .expect(200);
    await request(h.http)
      .put('/v1/me/interests')
      .set(...bearer(twin.token))
      .send({ interestIds: ids3.slice(30, 33) })
      .expect(200);
    const res = await request(h.http)
      .get('/v1/social/suggestions')
      .set(...bearer(me.token))
      .expect(200);
    const twinSuggestion = (
      res.body.items as { person: { id: string }; reasons: string[]; sharedInterestCount: number }[]
    ).find((s) => s.person.id === twin.id);
    expect(twinSuggestion).toMatchObject({ reasons: ['shared_interests'], sharedInterestCount: 3 });
    for (const s of res.body.items as { reasons: string[]; sharedInterestCount: number }[]) {
      if (s.reasons.length === 1 && s.reasons[0] === 'shared_interests')
        expect(s.sharedInterestCount).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('reports (F-SOC-05)', () => {
  it('routes severity by category, escalates on many reporters, dedupes, and lands in the admin queue', async () => {
    const target = await member(h);
    const reporters = [await member(h), await member(h), await member(h)];
    const report = (m: Member, category: string, extra: Record<string, unknown> = {}) =>
      request(h.http)
        .post('/v1/reports')
        .set(...bearer(m.token))
        .set(...idem())
        .send({ targetType: 'user', targetId: target.id, category, ...extra });

    const first = await report(reporters[0] as Member, 'spam').expect(201);
    expect(first.body.severity).toBe('low');
    const again = await report(reporters[0] as Member, 'spam').expect(201);
    expect(again.body.id).toBe(first.body.id);
    await report(reporters[1] as Member, 'spam').expect(201);
    const third = await report(reporters[2] as Member, 'spam', {
      details: 'Sends links to everyone',
      alsoBlock: true,
    }).expect(201);
    expect(third.body.severity).toBe('medium');
    await profileOf(reporters[2] as Member, target).expect(404);

    const admin = await signIn(h, SEED_ADMIN_PHONE, { inviteCode: null });
    const queue = await request(h.http)
      .get('/v1/admin/moderation/queue?limit=100')
      .set(...bearer(admin.accessToken))
      .expect(200);
    const item = (
      queue.body.items as {
        targetId: string;
        severity: string;
        reportCount: number;
        source: string;
      }[]
    ).find((i) => i.targetId === target.id);
    expect(item).toMatchObject({ source: 'report', severity: 'medium', reportCount: 3 });
    const severities = (queue.body.items as { severity: string }[]).map((i) =>
      ['critical', 'high', 'medium', 'low'].indexOf(i.severity),
    );
    expect([...severities].sort((x, y) => x - y)).toEqual(severities);
    await request(h.http)
      .get('/v1/admin/moderation/queue')
      .set(...bearer((reporters[0] as Member).token))
      .expect(403);
  });

  it('critical categories, screenshots, and invalid targets', async () => {
    const [reporter, target] = [await member(h), await member(h)];
    const shot = await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(reporter.token))
      .send({ purpose: 'report_screenshot', contentType: 'image/png', sizeBytes: 10 })
      .expect(201);
    const res = await request(h.http)
      .post('/v1/reports')
      .set(...bearer(reporter.token))
      .set(...idem())
      .send({
        targetType: 'user',
        targetId: target.id,
        category: 'underage',
        screenshotMediaIds: [shot.body.assetId],
      })
      .expect(201);
    expect(res.body.severity).toBe('critical');
    const send = (body: Record<string, unknown>) =>
      request(h.http)
        .post('/v1/reports')
        .set(...bearer(reporter.token))
        .set(...idem())
        .send({ targetType: 'user', category: 'spam', ...body });
    await send({ targetId: reporter.id }).expect(400);
    await send({ targetId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' }).expect(404);
    // Every target type is reportable since Phase 7 (Lore); an unknown photo looks like any missing target.
    await send({ targetType: 'lore_media', targetId: target.id }).expect(404);
    const photo = await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(reporter.token))
      .send({ purpose: 'profile_photo', contentType: 'image/png', sizeBytes: 10 })
      .expect(201);
    await send({
      targetId: target.id,
      category: 'scam',
      screenshotMediaIds: [photo.body.assetId],
    }).expect(400);
  });
});

describe('activity feed (F-SOC-04)', () => {
  it("shows the squad's activity, respects share-activity settings and blocks, and is idempotent", async () => {
    const [me, b, c, d] = [
      await member(h),
      await member(h, { displayName: 'Feed B' }),
      await member(h, { displayName: 'Feed C' }),
      await member(h),
    ];
    await befriend(h, me, b);
    await befriend(h, b, c);
    await befriend(h, c, d);
    await drainOutbox();

    const feed = await request(h.http)
      .get('/v1/activity')
      .set(...bearer(me.token))
      .expect(200);
    const verbs = (
      feed.body.items as { verb: string; actor: { id: string }; subject: { id: string } | null }[]
    ).map((i) => `${i.verb}:${i.actor.id}:${i.subject?.id ?? ''}`);
    expect(verbs).toContain(`squad_joined:${c.id}:${b.id}`);
    expect(verbs).toContain(`joined:${b.id}:`);
    expect(verbs.filter((v) => v.includes(d.id))).toEqual([]);
    expect(verbs.filter((v) => v.includes(me.id))).toEqual([]);
    expect(new Set(verbs).size).toBe(verbs.length);

    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(c.token))
      .send({ shareActivity: false })
      .expect(200);
    const quieter = await request(h.http)
      .get('/v1/activity')
      .set(...bearer(me.token))
      .expect(200);
    expect(JSON.stringify(quieter.body)).not.toContain(c.id);

    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(me.token))
      .send({ userId: b.id })
      .expect(204);
    expect(
      (
        await request(h.http)
          .get('/v1/activity')
          .set(...bearer(me.token))
          .expect(200)
      ).body.items,
    ).toEqual([]);
  });

  it('paginates', async () => {
    const hub = await member(h);
    for (let i = 0; i < 3; i += 1) await befriend(h, await member(h), hub);
    const viewer = await member(h);
    await befriend(h, viewer, hub);
    await drainOutbox();
    const p1 = await request(h.http)
      .get('/v1/activity?limit=2')
      .set(...bearer(viewer.token))
      .expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await request(h.http)
      .get(`/v1/activity?limit=2&cursor=${p1.body.nextCursor as string}`)
      .set(...bearer(viewer.token))
      .expect(200);
    expect(p2.body.items.map((i: { id: string }) => i.id)).not.toContain(p1.body.items[0].id);
  });
});

describe('account data (DPDP)', () => {
  it('exports and erases social data', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    const exported = await request(h.http)
      .get('/v1/me/export')
      .set(...bearer(a.token))
      .expect(200);
    expect(exported.body.social.friendships).toEqual([
      expect.objectContaining({ with: b.id, status: 'accepted', requestedByMe: true }),
    ]);
    await h.app.get(AccountService).purge(a.id);
    expect(
      (
        await request(h.http)
          .get('/v1/social/squad')
          .set(...bearer(b.token))
      ).body.items,
    ).toEqual([]);
    expect(
      (
        await h.pool.query('SELECT 1 FROM friendships WHERE user_low = $1 OR user_high = $1', [
          a.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await h.app.get(UsersService).statusOf(a.id)).toBe('deleted');
  });
});
