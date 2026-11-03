import { LIMITS } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FakeSmsSender } from '../src/adapters/sms/fake.sms.js';
import { OtpService } from '../src/modules/auth/otp.service.js';
import * as schema from '../src/infra/database/schema/index.js';
import { InvitesService } from '../src/modules/invites/invites.service.js';
import { SEED_INVITE_CODE } from '../src/seed/seed.js';
import {
  bearer,
  createHarness,
  fromIp,
  device,
  freshPhone,
  type Harness,
  onboard,
  requestOtp,
  setInviteGate,
  signIn,
} from './harness.js';
import { integrationEnv } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await setInviteGate(h, true);
});

describe('OTP request', () => {
  it('normalises Indian formats, sends via the SMS adapter and stores only a hash', async () => {
    const phone = freshPhone();
    const local = phone.replace('+91', '0');
    const res = await request(h.http)
      .post('/v1/auth/otp/request')
      .set(...fromIp())
      .send({ phone: local })
      .expect(200);
    expect(res.body.resendAfterSeconds).toBe(30);
    const code = h.sms.lastOtpFor(phone);
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await h.pool.query<{ code_hash: string }>(
      'SELECT code_hash FROM otp_requests WHERE phone_e164 = $1',
      [phone],
    );
    expect(rows[0]?.code_hash).not.toContain(code ?? 'x');
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      LIMITS.otp.ttlMs,
    );
  });

  it('enforces the resend cooldown and rejects invalid numbers', async () => {
    const phone = freshPhone();
    await requestOtp(h, phone);
    const again = await request(h.http)
      .post('/v1/auth/otp/request')
      .set(...fromIp())
      .send({ phone })
      .expect(429);
    expect(again.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: expect.any(Number) as number },
    });
    const bad = await request(h.http)
      .post('/v1/auth/otp/request')
      .set(...fromIp())
      .send({ phone: '12345' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('per-IP abuse limits', () => {
  it('caps OTP requests per IP across different numbers', async () => {
    const ip = fromIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1)
      statuses.push(
        (
          await request(h.http)
            .post('/v1/auth/otp/request')
            .set(...ip)
            .send({ phone: freshPhone() })
        ).status,
      );
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('OTP verify', () => {
  it('counts wrong attempts and locks the code after 5', async () => {
    const phone = freshPhone();
    const code = await requestOtp(h, phone);
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 1; i < LIMITS.otp.maxAttempts; i += 1) {
      const res = await request(h.http)
        .post('/v1/auth/otp/verify')
        .set(...fromIp())
        .send({ phone, code: wrong, device: device() })
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'OTP_INVALID',
        details: { attemptsRemaining: LIMITS.otp.maxAttempts - i },
      });
    }
    await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code: wrong, device: device() })
      .expect(429);
    const locked = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code, inviteCode: SEED_INVITE_CODE, device: device() })
      .expect(429);
    expect(locked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('rejects expired codes', async () => {
    const phone = freshPhone();
    const code = await requestOtp(h, phone);
    await h.pool.query(
      "UPDATE otp_requests SET expires_at = now() - interval '1 second' WHERE phone_e164 = $1",
      [phone],
    );
    const res = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code, inviteCode: SEED_INVITE_CODE, device: device() })
      .expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('a code cannot be used twice', async () => {
    const phone = freshPhone();
    const code = await requestOtp(h, phone);
    const body = { phone, code, inviteCode: SEED_INVITE_CODE, device: device() };
    await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send(body)
      .expect(200);
    const again = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send(body)
      .expect(400);
    expect(again.body.error.code).toBe('OTP_EXPIRED');
  });

  it('accepts the dev bypass code outside production only', async () => {
    const phone = freshPhone();
    await requestOtp(h, phone);
    await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({
        phone,
        code: LIMITS.otp.devBypassCode,
        inviteCode: SEED_INVITE_CODE,
        device: device(),
      })
      .expect(200);

    const prodEnv = { ...integrationEnv(), NODE_ENV: 'production' as const };
    const db = drizzle(h.pool, { schema });
    const otp = new OtpService(db, prodEnv, new FakeSmsSender());
    const phone2 = freshPhone();
    await otp.issue(phone2, null);
    await expect(otp.check(phone2, LIMITS.otp.devBypassCode)).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(await otp.hasPending(phone2)).toBe(true);
    expect(await otp.purgeExpired(new Date(Date.now() + 2 * 86_400_000))).toBeGreaterThan(0);
  });
});

describe('store review sign-in', () => {
  it('gives the review number its fixed code in production, without an SMS, and caps wrong guesses', async () => {
    const reviewPhone = freshPhone();
    const env = {
      ...integrationEnv(),
      NODE_ENV: 'production' as const,
      STORE_REVIEW_PHONE: reviewPhone,
      STORE_REVIEW_OTP: '482913',
    };
    const sms = new FakeSmsSender();
    const otp = new OtpService(drizzle(h.pool, { schema }), env, sms);

    await otp.issue(reviewPhone, null);
    expect(sms.lastOtpFor(reviewPhone)).toBeUndefined();
    await expect(otp.check(reviewPhone, LIMITS.otp.devBypassCode)).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(await otp.check(reviewPhone, '482913')).toEqual(expect.any(String));

    // Wrong guesses still burn attempts and lock the code.
    const later = new Date(Date.now() + LIMITS.otp.resendAfterMs + 1000);
    await otp.issue(reviewPhone, null, later);
    for (let i = 0; i < LIMITS.otp.maxAttempts - 1; i += 1)
      await expect(otp.check(reviewPhone, '111111', later)).rejects.toMatchObject({
        code: 'OTP_INVALID',
      });
    await expect(otp.check(reviewPhone, '111111', later)).rejects.toMatchObject({
      code: 'OTP_TOO_MANY_ATTEMPTS',
    });
    await expect(otp.check(reviewPhone, '482913', later)).rejects.toMatchObject({
      code: 'OTP_TOO_MANY_ATTEMPTS',
    });

    // Every other number still gets a random code by SMS.
    const other = freshPhone();
    await otp.issue(other, null);
    expect(sms.lastOtpFor(other)).toMatch(/^\d{6}$/);
    expect(sms.lastOtpFor(other)).not.toBe('482913');
  });
});

describe('invite gate (F-ACC-01)', () => {
  it('requires an invite for new users while the gate is on, without burning the code', async () => {
    const phone = freshPhone();
    const code = await requestOtp(h, phone);
    const blocked = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code, device: device() })
      .expect(403);
    expect(blocked.body.error.code).toBe('INVITE_REQUIRED');
    const bad = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code, inviteCode: 'NOPE-NOPE', device: device() })
      .expect(400);
    expect(bad.body.error.code).toBe('INVITE_INVALID');
    const ok = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code, inviteCode: SEED_INVITE_CODE.toLowerCase(), device: device() })
      .expect(200);
    expect(ok.body).toMatchObject({
      isNewUser: true,
      user: { status: 'onboarding', onboardingComplete: false },
    });
    const { rows } = await h.pool.query('SELECT 1 FROM invite_redemptions WHERE user_id = $1', [
      ok.body.user.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('lets anyone sign up when the gate is off', async () => {
    await setInviteGate(h, false);
    const res = await signIn(h, freshPhone(), { inviteCode: null });
    expect(res.isNewUser).toBe(true);
  });

  it('existing users never need an invite', async () => {
    const first = await signIn(h);
    const again = await signIn(h, first.phone, { inviteCode: null });
    expect(again).toMatchObject({ isNewUser: false, user: { id: first.user.id } });
  });

  it('user invites record the invite tree and show the inviter name', async () => {
    const inviter = await signIn(h);
    await onboard(h, inviter.accessToken, { displayName: 'Ananya Inviter' });
    const created = await request(h.http)
      .post('/v1/me/invites')
      .set(...bearer(inviter.accessToken))
      .set('Idempotency-Key', `inv-${Date.now()}`)
      .expect(201);
    const check = await request(h.http)
      .post('/v1/auth/invites/check')
      .set(...fromIp())
      .send({ code: created.body.code })
      .expect(200);
    expect(check.body).toEqual({ valid: true, inviterName: 'Ananya Inviter' });
    const invitee = await signIn(h, freshPhone(), { inviteCode: created.body.code as string });
    const { rows } = await h.pool.query<{ invited_by_user_id: string }>(
      'SELECT invited_by_user_id FROM users WHERE id = $1',
      [invitee.user.id],
    );
    expect(rows[0]?.invited_by_user_id).toBe(inviter.user.id);
    expect(
      (
        await request(h.http)
          .post('/v1/auth/invites/check')
          .set(...fromIp())
          .send({ code: created.body.code })
          .expect(200)
      ).body.valid,
    ).toBe(false);
    expect(await h.app.get(InvitesService).inviteesOf(inviter.user.id)).toHaveLength(1);
  });

  it('exactly N concurrent signups succeed on an N-use code (no over-redemption)', async () => {
    const admin = h.app.get(InvitesService);
    const [code] = await admin.createBulk(
      (await signIn(h)).user.id,
      { count: 1, maxUses: 5, expiresAt: null, label: 'race' },
      drizzle(h.pool, { schema }),
    );
    const phones = Array.from({ length: 20 }, () => freshPhone());
    const codes = await Promise.all(phones.map((p) => requestOtp(h, p)));
    const results = await Promise.all(
      phones.map((phone, i) =>
        request(h.http)
          .post('/v1/auth/otp/verify')
          .set(...fromIp())
          .send({ phone, code: codes[i], inviteCode: code?.code, device: device() }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(
      results.filter((r) => r.status !== 200).every((r) => r.body.error.code === 'INVITE_INVALID'),
    ).toBe(true);
    const { rows } = await h.pool.query<{ uses: number }>(
      'SELECT uses FROM invite_codes WHERE id = $1',
      [code?.id],
    );
    expect(rows[0]?.uses).toBe(5);
  });
});

describe('sessions and tokens (F-ACC-02)', () => {
  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const s = await signIn(h);
    const r1 = await request(h.http)
      .post('/v1/auth/refresh')
      .set(...fromIp())
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(r1.body.accessToken as string))
      .expect(200);
    const replay = await request(h.http)
      .post('/v1/auth/refresh')
      .set(...fromIp())
      .send({ refreshToken: s.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');
    const after = await request(h.http)
      .get('/v1/me')
      .set(...bearer(r1.body.accessToken as string))
      .expect(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
    await request(h.http)
      .post('/v1/auth/refresh')
      .set(...fromIp())
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
    const { rows } = await h.pool.query(
      'SELECT token_hash FROM refresh_tokens WHERE token_hash = $1',
      [s.refreshToken],
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects garbage refresh tokens and missing or forged access tokens', async () => {
    await request(h.http)
      .post('/v1/auth/refresh')
      .set(...fromIp())
      .send({ refreshToken: 'x'.repeat(43) })
      .expect(401);
    expect((await request(h.http).get('/v1/me').expect(401)).body.error.code).toBe(
      'UNAUTHENTICATED',
    );
    expect(
      (await request(h.http).get('/v1/me').set('Authorization', 'Bearer a.b.c').expect(401)).body
        .error.code,
    ).toBe('UNAUTHENTICATED');
  });

  it('lists per-device sessions, revokes one, and logout kills the current token', async () => {
    const phone = freshPhone();
    const a = await signIn(h, phone, { deviceInfo: device('Pixel') });
    const b = await signIn(h, phone, { deviceInfo: device('iPhone') });
    const list = await request(h.http)
      .get('/v1/me/sessions')
      .set(...bearer(b.accessToken))
      .expect(200);
    expect(list.body.items.map((s: { deviceName: string }) => s.deviceName).sort()).toEqual([
      'Pixel',
      'iPhone',
    ]);
    expect(list.body.items.find((s: { current: boolean }) => s.current).deviceName).toBe('iPhone');
    await request(h.http)
      .delete(`/v1/me/sessions/${a.sessionId}`)
      .set(...bearer(b.accessToken))
      .expect(204);
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(a.accessToken))
      .expect(401);
    await request(h.http)
      .delete(`/v1/me/sessions/${a.sessionId}`)
      .set(...bearer(b.accessToken))
      .expect(404);
    await request(h.http)
      .post('/v1/auth/logout')
      .set(...bearer(b.accessToken))
      .expect(204);
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(b.accessToken))
      .expect(401);
  });

  it('signing in again on the same device replaces its session', async () => {
    const phone = freshPhone();
    const d = device('Same phone');
    const first = await signIn(h, phone, { deviceInfo: d });
    const second = await signIn(h, phone, { deviceInfo: d });
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(first.accessToken))
      .expect(401);
    const list = await request(h.http)
      .get('/v1/me/sessions')
      .set(...bearer(second.accessToken))
      .expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('suspended accounts cannot sign in or refresh', async () => {
    const s = await signIn(h);
    await h.pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [s.user.id]);
    await h.app
      .get((await import('../src/modules/users/users.service.js')).UsersService)
      .setStatus(s.user.id, 'suspended');
    const code = await requestOtp(h, s.phone);
    const res = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone: s.phone, code, device: device() })
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(
      (
        await request(h.http)
          .post('/v1/auth/refresh')
          .set(...fromIp())
          .send({ refreshToken: s.refreshToken })
          .expect(403)
      ).body.error.code,
    ).toBe('ACCOUNT_SUSPENDED');
    expect(
      (
        await request(h.http)
          .get('/v1/me')
          .set(...bearer(s.accessToken))
          .expect(401)
      ).body.error.code,
    ).toBe('SESSION_REVOKED');
  });

  it('users still onboarding can only reach onboarding routes', async () => {
    const s = await signIn(h);
    const other = await signIn(h);
    const res = await request(h.http)
      .get(`/v1/users/${other.user.id}/profile`)
      .set(...bearer(s.accessToken))
      .expect(409);
    expect(res.body.error.code).toBe('ONBOARDING_INCOMPLETE');
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(s.accessToken))
      .expect(200);
  });
});
