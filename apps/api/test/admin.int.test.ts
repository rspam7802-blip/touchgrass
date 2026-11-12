import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service.js';
import type { Redis } from 'ioredis';
import { REDIS } from '../src/infra/redis/redis.module.js';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service.js';
import { SEED_ADMIN_PHONE } from '../src/seed/seed.js';
import { bearer, createHarness, fromIp, type Harness, onboard, signIn } from './harness.js';

let h: Harness;
let admin: string;
let member: string;

beforeAll(async () => {
  h = await createHarness();
  admin = (await signIn(h, SEED_ADMIN_PHONE, { inviteCode: null })).accessToken;
  const m = await signIn(h);
  await onboard(h, m.accessToken);
  member = m.accessToken;
});
afterAll(async () => {
  await h.close();
});

describe('admin authorisation', () => {
  it('rejects members and anonymous callers on every admin route', async () => {
    for (const [method, path] of [
      ['get', '/v1/admin/invite-codes'],
      ['post', '/v1/admin/invite-codes/bulk'],
      ['get', '/v1/admin/feature-flags'],
      ['put', '/v1/admin/feature-flags/invite_gate'],
      ['get', '/v1/admin/settings'],
      ['get', '/v1/admin/audit-log'],
    ] as const) {
      const res = await request(h.http)
        [method](path)
        .set(...bearer(member))
        .set('Idempotency-Key', `x-${Date.now()}`)
        .send({});
      expect(res.status, path).toBe(403);
      expect((await request(h.http)[method](path).send({})).status).toBe(401);
    }
  });

  it('roles from the token: admins without super_admin cannot flip feature flags', async () => {
    const s = await signIn(h);
    await onboard(h, s.accessToken);
    await h.app.get(UsersService).grantRole(s.user.id, 'admin', null);
    const refreshed = await request(h.http)
      .post('/v1/auth/refresh')
      .set(...fromIp())
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    const token = refreshed.body.accessToken as string;
    await request(h.http)
      .get('/v1/admin/invite-codes')
      .set(...bearer(token))
      .expect(200);
    await request(h.http)
      .put('/v1/admin/feature-flags/invite_gate')
      .set(...bearer(token))
      .send({ enabled: false })
      .expect(403);
  });

  it('staff who have not finished their member profile can still use the admin routes their role allows', async () => {
    // e.g. the first super admin, created by the production bootstrap before any profile exists
    const s = await signIn(h);
    await h.app.get(UsersService).grantRole(s.user.id, 'admin', null);
    const refreshed = await request(h.http)
      .post('/v1/auth/refresh')
      .set(...fromIp())
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    const token = refreshed.body.accessToken as string;
    await request(h.http)
      .get('/v1/admin/invite-codes')
      .set(...bearer(token))
      .expect(200);
    // Routes the role doesn't cover stay closed (feature flags are super_admin only; the onboarding check
    // answers first), and member routes still need a finished profile.
    await request(h.http)
      .put('/v1/admin/feature-flags/invite_gate')
      .set(...bearer(token))
      .send({ enabled: false })
      .expect(409);
    expect(
      (
        await request(h.http)
          .get(`/v1/users/${s.user.id}/profile`)
          .set(...bearer(token))
          .expect(409)
      ).body.error.code,
    ).toBe('ONBOARDING_INCOMPLETE');
  });
});

describe('invite codes admin (F-ACC-01)', () => {
  it('bulk-creates multi-use codes idempotently, audits, lists with cursors and revokes', async () => {
    const key = `bulk-${Date.now()}`;
    const body = {
      count: 3,
      maxUses: 25,
      label: 'Launch party',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    const first = await request(h.http)
      .post('/v1/admin/invite-codes/bulk')
      .set(...bearer(admin))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await request(h.http)
      .post('/v1/admin/invite-codes/bulk')
      .set(...bearer(admin))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.items[0]).toMatchObject({
      maxUses: 25,
      uses: 0,
      label: 'Launch party',
      revoked: false,
    });
    expect(first.body.items[0].code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const page1 = await request(h.http)
      .get('/v1/admin/invite-codes?limit=2')
      .set(...bearer(admin))
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    const page2 = await request(h.http)
      .get(`/v1/admin/invite-codes?limit=2&cursor=${page1.body.nextCursor as string}`)
      .set(...bearer(admin))
      .expect(200);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[1].id);
    await request(h.http)
      .get('/v1/admin/invite-codes?cursor=garbage')
      .set(...bearer(admin))
      .expect(400);

    const id = first.body.items[0].id as string;
    const revoked = await request(h.http)
      .post(`/v1/admin/invite-codes/${id}/revoke`)
      .set(...bearer(admin))
      .expect(200);
    expect(revoked.body.revoked).toBe(true);
    expect(
      (
        await request(h.http)
          .post('/v1/auth/invites/check')
          .set(...fromIp())
          .send({ code: revoked.body.code })
          .expect(200)
      ).body.valid,
    ).toBe(false);
    await request(h.http)
      .post('/v1/admin/invite-codes/0192f3a4-5b6c-7d8e-9f01-23456789abcd/revoke')
      .set(...bearer(admin))
      .expect(404);

    const audit = await request(h.http)
      .get('/v1/admin/audit-log?limit=5')
      .set(...bearer(admin))
      .expect(200);
    const actions = audit.body.items.map((a: { action: string }) => a.action);
    expect(actions).toContain('invite_codes.bulk_create');
    expect(actions).toContain('invite_codes.revoke');
    expect(audit.body.items[0].adminName).toBe('Team TouchGrass');
  });

  it('turning the invite gate off opens signup and is reflected in app config', async () => {
    await request(h.http)
      .put('/v1/admin/feature-flags/invite_gate')
      .set(...bearer(admin))
      .send({ enabled: false })
      .expect(200);
    expect((await request(h.http).get('/v1/app/config').expect(200)).body.flags.invite_gate).toBe(
      false,
    );
    const flags = await request(h.http)
      .get('/v1/admin/feature-flags')
      .set(...bearer(admin))
      .expect(200);
    expect(flags.body.items.find((f: { key: string }) => f.key === 'invite_gate').enabled).toBe(
      false,
    );
    await request(h.http)
      .put('/v1/admin/feature-flags/not_a_flag')
      .set(...bearer(admin))
      .send({ enabled: true })
      .expect(404);
    await request(h.http)
      .put('/v1/admin/feature-flags/invite_gate')
      .set(...bearer(admin))
      .send({ enabled: true })
      .expect(200);
  });

  it('a reader that loaded flags before a write cannot re-cache the stale value', async () => {
    const flags = h.app.get(FeatureFlagsService);
    const redis = h.app.get<Redis>(REDIS);
    expect((await flags.all()).referrals).toBe(true);
    // A slow reader captures the cache key, then a write commits before it fills the cache.
    const staleGeneration = (await redis.get('cache:feature-flags:generation')) ?? '0';
    await flags.set('referrals', false);
    await redis.set(
      `cache:feature-flags:v2:${staleGeneration}`,
      JSON.stringify({ referrals: true }),
      'EX',
      30,
    );
    expect(await flags.isEnabled('referrals')).toBe(false);
    await flags.set('referrals', true);
    expect(await flags.isEnabled('referrals')).toBe(true);
  });
});

describe('per-user invite quota (configurable)', () => {
  it('honours the admin-set quota and returns INVITE_QUOTA_EXHAUSTED', async () => {
    await request(h.http)
      .put('/v1/admin/settings/invites_per_user')
      .set(...bearer(admin))
      .send({ value: 2 })
      .expect(200);
    await request(h.http)
      .put('/v1/admin/settings/not_a_setting')
      .set(...bearer(admin))
      .send({ value: 2 })
      .expect(400);
    const s = await signIn(h);
    await onboard(h, s.accessToken);
    const create = (k: string) =>
      request(h.http)
        .post('/v1/me/invites')
        .set(...bearer(s.accessToken))
        .set('Idempotency-Key', k);
    await create(`q1-${Date.now()}`).expect(201);
    await create(`q2-${Date.now()}`).expect(201);
    const over = await create(`q3-${Date.now()}`).expect(409);
    expect(over.body.error.code).toBe('INVITE_QUOTA_EXHAUSTED');
    const mine = await request(h.http)
      .get('/v1/me/invites')
      .set(...bearer(s.accessToken))
      .expect(200);
    expect(mine.body).toMatchObject({ quota: 2, remaining: 0 });
    expect(mine.body.shareUrlBase).toMatch(/\/invite$/);
    const settings = await request(h.http)
      .get('/v1/admin/settings')
      .set(...bearer(admin))
      .expect(200);
    expect(settings.body.items).toEqual([
      { key: 'invites_per_user', value: 2 },
      { key: 'waitlist_claim_minutes', value: 30 },
      { key: 'platform_fee_bps', value: 1000 },
      { key: 'payout_delay_hours', value: 24 },
      { key: 'referral_priority_passes', value: 2 },
      { key: 'referral_credits', value: 1 },
      { key: 'referral_credit_max_rupees', value: 500 },
      { key: 'referral_max_rewarded', value: 20 },
    ]);
    await request(h.http)
      .put('/v1/admin/settings/invites_per_user')
      .set(...bearer(admin))
      .send({ value: 5 })
      .expect(200);
  });

  it('concurrent invite creation never exceeds the quota', async () => {
    const s = await signIn(h);
    await onboard(h, s.accessToken);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(h.http)
          .post('/v1/me/invites')
          .set(...bearer(s.accessToken))
          .set('Idempotency-Key', `race-${i}-${Date.now()}`),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
  });
});
