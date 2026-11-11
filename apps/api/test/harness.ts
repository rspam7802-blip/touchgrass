import type { INestApplication } from '@nestjs/common';
import type { AuthResponse } from '@touchgrass/shared';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import type { AdapterInstances } from '../src/adapters/adapters.module.js';
import { FakeSmsSender } from '../src/adapters/sms/fake.sms.js';
import { MemoryObjectStorage } from '../src/adapters/storage/memory.storage.js';
import { createApiApp } from '../src/bootstrap.js';
import { MediaProcessor } from '../src/modules/media/media.processor.js';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service.js';
import { SEED_INVITE_CODE } from '../src/seed/seed.js';
import { integrationEnv } from './helpers.js';

export interface Harness {
  app: INestApplication;
  http: Server;
  sms: FakeSmsSender;
  storage: MemoryObjectStorage;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** The real API app wired to fake SMS + in-memory storage, against the Testcontainers Postgres/Redis. */
export async function createHarness(
  overrides: Partial<AdapterInstances> = {},
  envOverrides: Record<string, string> = {},
): Promise<Harness> {
  const sms = new FakeSmsSender();
  const storage = new MemoryObjectStorage('http://media.test');
  const env = integrationEnv({
    STORAGE_PROVIDER: 'memory',
    TRUST_PROXY_HOPS: '1',
    ...envOverrides,
  });
  const app = await createApiApp(env, {
    logger: false,
    adapterOverrides: { sms, storage, ...overrides },
  });
  // Bind once so nested supertest calls never race on auto-listen/close of an unbound server.
  await app.listen(0, '127.0.0.1');
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3 });
  return {
    app,
    http: app.getHttpServer() as Server,
    sms,
    storage,
    pool,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

let ipCounter = Math.floor(Math.random() * 16_000_000);
/** A distinct client IP (via the trusted proxy header), so per-IP limits don't couple unrelated tests. */
export function fromIp(): [string, string] {
  ipCounter += 1;
  return [
    'X-Forwarded-For',
    `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`,
  ];
}

let phoneCounter = 0;
/** Unique, valid Indian mobile per call (prefix 7 keeps clear of seed numbers). */
export function freshPhone(): string {
  phoneCounter += 1;
  const n = (Date.now() % 1_000_000) * 100 + (phoneCounter % 100);
  return `+917${String(n).padStart(9, '0').slice(-9)}`;
}

export function device(name = 'Test phone'): {
  deviceId: string;
  name: string;
  platform: 'android';
  appVersion: string;
} {
  return { deviceId: randomUUID(), name, platform: 'android', appVersion: '0.1.0' };
}

export async function requestOtp(h: Harness, phone: string): Promise<string> {
  // Simulate the 30 s resend cooldown having passed for any earlier code to this number.
  await h.pool.query(
    "UPDATE otp_requests SET created_at = created_at - interval '1 minute' WHERE phone_e164 = $1",
    [phone],
  );
  await request(h.http)
    .post('/v1/auth/otp/request')
    .set(...fromIp())
    .send({ phone })
    .expect(200);
  const code = h.sms.lastOtpFor(phone);
  if (!code) throw new Error('OTP not sent');
  return code;
}

/** Full sign-in (new users get the seed invite code). */
export async function signIn(
  h: Harness,
  phone = freshPhone(),
  opts: { inviteCode?: string | null; deviceInfo?: ReturnType<typeof device> } = {},
): Promise<AuthResponse & { phone: string }> {
  const code = await requestOtp(h, phone);
  const inviteCode = opts.inviteCode === null ? undefined : (opts.inviteCode ?? SEED_INVITE_CODE);
  const res = await request(h.http)
    .post('/v1/auth/otp/verify')
    .set(...fromIp())
    .send({ phone, code, inviteCode, device: opts.deviceInfo ?? device() });
  if (res.status !== 200)
    throw new Error(`signIn failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...(res.body as AuthResponse), phone };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

export async function testJpeg(width = 1600, height = 1200, exif = false): Promise<Buffer> {
  let img = sharp({
    create: { width, height, channels: 3, background: { r: 31, g: 166, b: 55 } },
  }).jpeg();
  if (exif)
    img = img.withExif({
      IFD0: { Copyright: 'touchgrass-test', ImageDescription: 'gps-bearing-original' },
    });
  return img.toBuffer();
}

/** Upload → complete → process (the worker step, run inline) → returns the asset id. */
export async function uploadPhoto(h: Harness, token: string, bytes?: Buffer): Promise<string> {
  const body = bytes ?? (await testJpeg());
  const created = await request(h.http)
    .post('/v1/media/uploads')
    .set(...bearer(token))
    .send({ purpose: 'profile_photo', contentType: 'image/jpeg', sizeBytes: body.length })
    .expect(201);
  const assetId = created.body.assetId as string;
  h.storage.simulateUpload(created.body.upload.fields.key as string, body, 'image/jpeg');
  await request(h.http)
    .post(`/v1/media/${assetId}/complete`)
    .set(...bearer(token))
    .expect(200);
  await h.app.get(MediaProcessor).process(assetId);
  return assetId;
}

export async function setInviteGate(h: Harness, enabled: boolean): Promise<void> {
  await h.app.get(FeatureFlagsService).set('invite_gate', enabled);
}

export async function cityAndHood(
  h: Harness,
): Promise<{ cityId: string; neighbourhoodId: string; otherCityHood?: string }> {
  const cities = await request(h.http)
    .get('/v1/cities')
    .set(...fromIp())
    .expect(200);
  // Tests live in Hyderabad (the seeded launch city); other seeded cities exist since Phase 11.
  const cityId = (cities.body.items as { id: string; slug: string }[]).find(
    (c) => c.slug === 'hyderabad',
  )?.id as string;
  const hoods = await request(h.http)
    .get(`/v1/cities/${cityId}/neighbourhoods`)
    .set(...fromIp())
    .expect(200);
  return { cityId, neighbourhoodId: hoods.body.items[0].id as string };
}

export async function interestIds(h: Harness, n: number): Promise<string[]> {
  const res = await request(h.http)
    .get('/v1/interests')
    .set(...fromIp())
    .expect(200);
  return (res.body.items as { id: string }[]).slice(0, n).map((i) => i.id);
}

/** Drives a new user through the whole onboarding to an active account. */
export async function onboard(
  h: Harness,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { cityId, neighbourhoodId } = await cityAndHood(h);
  await request(h.http)
    .patch('/v1/me/profile')
    .set(...bearer(token))
    .send({
      displayName: 'Test Person',
      dateOfBirth: '1998-05-20',
      gender: 'woman',
      cityId,
      neighbourhoodId,
      ...overrides,
    })
    .expect(200);
  await request(h.http)
    .put('/v1/me/interests')
    .set(...bearer(token))
    .send({ interestIds: await interestIds(h, 3) })
    .expect(200);
  const photo = await uploadPhoto(h, token);
  await request(h.http)
    .put('/v1/me/photos')
    .set(...bearer(token))
    .send({ mediaAssetIds: [photo] })
    .expect(200);
  await request(h.http)
    .post('/v1/me/onboarding/complete')
    .set(...bearer(token))
    .expect(200);
}

export interface Member {
  id: string;
  token: string;
  phone: string;
}

/** A fully onboarded, active member. */
export async function member(h: Harness, overrides: Record<string, unknown> = {}): Promise<Member> {
  const s = await signIn(h);
  await onboard(h, s.accessToken, overrides);
  return { id: s.user.id, token: s.accessToken, phone: s.phone };
}

/** Makes two members squad via the real request/accept endpoints. */
export async function befriend(h: Harness, a: Member, b: Member): Promise<void> {
  await request(h.http)
    .post('/v1/social/requests')
    .set(...bearer(a.token))
    .set('Idempotency-Key', `req-${a.id}-${b.id}`)
    .send({ userId: b.id })
    .expect(200);
  await request(h.http)
    .post(`/v1/social/requests/${a.id}/accept`)
    .set(...bearer(b.token))
    .expect(200);
}
