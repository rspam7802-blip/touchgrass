import type { AuthResponse, MyLiveShare } from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoSmsSender } from '../src/adapters/sms/none.sms.js';
import { idem } from './event-helpers.js';
import {
  bearer,
  createHarness,
  device,
  fromIp,
  type Harness,
  onboard,
  setInviteGate,
} from './harness.js';

let h: Harness;

beforeAll(async () => {
  // Live-launch shape (D-166): Firebase proves phone numbers, the server sends no SMS.
  h = await createHarness(
    { sms: new NoSmsSender() },
    { PHONE_AUTH_PROVIDER: 'fake', SMS_PROVIDER: 'none' },
  );
});
afterAll(async () => {
  await h.close();
});

const phone = (): string => `+9198${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const proof = (p: string): string => `fake-phone:${p}:${randomUUID()}`;
const signIn = (token: string, extra: Record<string, unknown> = {}) =>
  request(h.http)
    .post('/v1/auth/phone-proof')
    .set(...fromIp())
    .send({ token, device: device(), ...extra });

describe('sign-in with a phone proof (D-166)', () => {
  it('creates the account once, signs it back in, and never accepts a proof twice', async () => {
    await setInviteGate(h, false);
    const p = phone();
    const first = proof(p);
    const created = (await signIn(first).expect(200)).body as AuthResponse;
    expect(created).toMatchObject({ isNewUser: true, user: { status: 'onboarding' } });
    const replay = await signIn(first).expect(401);
    expect(replay.body.error.details).toMatchObject({ reason: 'USED' });
    const again = (await signIn(proof(p)).expect(200)).body as AuthResponse;
    expect(again).toMatchObject({ isNewUser: false, user: { id: created.user.id } });
    await signIn('fake-phone:not-a-number:x').expect(401);
  });

  it('keeps the invite gate, and a refused proof stays usable after adding an invite', async () => {
    await setInviteGate(h, true);
    try {
      const token = proof(phone());
      const gated = await signIn(token).expect(403);
      expect(gated.body.error.code).toBe('INVITE_REQUIRED');
      // Not consumed: the person can retry with an invite code without a new SMS.
      const retried = await signIn(token, { inviteCode: 'NOPE-0000' });
      expect(retried.status).not.toBe(401);
    } finally {
      await setInviteGate(h, false);
    }
  });
});

describe('no server SMS (SMS_PROVIDER=none)', () => {
  it('our own codes are refused for ordinary numbers', async () => {
    const res = await request(h.http)
      .post('/v1/auth/otp/request')
      .set(...fromIp())
      .send({ phone: phone() })
      .expect(403);
    expect(res.body.error.details).toMatchObject({ reason: 'SMS_OFF' });
  });

  it('SOS still starts and returns the link, with no contacts texted, so the app texts them', async () => {
    // Signed up with a phone proof, since this server sends no codes.
    await setInviteGate(h, false);
    const session = (await signIn(proof(phone())).expect(200)).body as AuthResponse;
    await onboard(h, session.accessToken);
    const m = { token: session.accessToken };
    await request(h.http)
      .post('/v1/safety/contacts')
      .set(...bearer(m.token))
      .set(...idem())
      .send({ name: 'Amma', phone: '+919876500002' })
      .expect((r) => expect([200, 201]).toContain(r.status));
    const sos = (
      await request(h.http)
        .post('/v1/safety/sos')
        .set(...bearer(m.token))
        .set(...idem())
        .send({})
        .expect(200)
    ).body as MyLiveShare;
    expect(sos.share?.contactsNotified).toBe(0);
    expect(sos.share?.link).toMatch(/^https?:\/\//);
  });
});
