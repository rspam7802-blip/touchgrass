import type {
  AdminUserDetail,
  AdminUserList,
  AdminVerificationList,
  ConversationSummary,
  CrewDetail,
  CrewList,
  EventDetail,
  MeResponse,
  Message,
  MessagePage,
  ModerationItemDetail,
  MyLiveShare,
  MyVerification,
  ProposalDetail,
  PublicLiveView,
  PublicProfile,
  TrustedContactList,
} from '@touchgrass/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountService } from '../src/modules/account/account.service.js';
import { MediaProcessor } from '../src/modules/media/media.processor.js';
import { ModerationService } from '../src/modules/moderation/moderation.service.js';
import { SanctionsService } from '../src/modules/moderation-tools/sanctions.service.js';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service.js';
import { SafetyService } from '../src/modules/safety/safety.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { VerificationService } from '../src/modules/verification/verification.service.js';
import {
  ADDRESS,
  idem,
  outboxFor,
  planBody,
  plot,
  shiftEvent,
  verifiedMember,
} from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  fromIp,
  type Harness,
  interestIds,
  member,
  type Member,
  onboard,
  signIn,
  testJpeg,
} from './harness.js';

let h: Harness;
let admin: Member;
const H = 3_600_000;
const DAY = 24 * H;

beforeAll(async () => {
  h = await createHarness();
  const s = await signIn(h);
  await onboard(h, s.accessToken);
  await h.app.get(UsersService).grantRole(s.user.id, 'moderator', null);
  const refreshed = await request(h.http)
    .post('/v1/auth/refresh')
    .set(...fromIp())
    .send({ refreshToken: s.refreshToken })
    .expect(200);
  admin = { id: s.user.id, token: refreshed.body.accessToken as string, phone: s.phone };
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
  patch: (path: string, body: object) =>
    request(h.http)
      .patch(path)
      .set(...bearer(m.token))
      .send(body),
  del: (path: string) =>
    request(h.http)
      .delete(path)
      .set(...bearer(m.token)),
});
const view = (token: string) =>
  request(h.http)
    .get(`/v1/live/${token}`)
    .set(...fromIp());

let phoneCounter = 0;
/** A distinct, valid Indian mobile number for contacts. */
function contactPhone(): string {
  phoneCounter += 1;
  return `+9198${String(Date.now() % 1_000_000).padStart(6, '0')}${String(phoneCounter % 100).padStart(2, '0')}`;
}

/** Upload → complete → process, for any purpose. */
async function upload(m: Member, purpose: string, bytes?: Buffer): Promise<string> {
  const body = bytes ?? (await testJpeg());
  const created = await request(h.http)
    .post('/v1/media/uploads')
    .set(...bearer(m.token))
    .send({ purpose, contentType: 'image/jpeg', sizeBytes: body.length })
    .expect(201);
  const id = created.body.assetId as string;
  h.storage.simulateUpload(created.body.upload.fields.key as string, body, 'image/jpeg');
  await request(h.http)
    .post(`/v1/media/${id}/complete`)
    .set(...bearer(m.token))
    .expect(200);
  await h.app.get(MediaProcessor).process(id);
  return id;
}

async function openItem(targetType: string, targetId: string): Promise<string> {
  const { rows } = await h.pool.query<{ id: string }>(
    `SELECT id FROM moderation_items WHERE target_type = $1 AND target_id = $2 AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [targetType, targetId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`no open item for ${targetType} ${targetId}`);
  return id;
}

const resolve = (itemId: string, body: object) =>
  api(admin).post(`/v1/admin/moderation/items/${itemId}/resolve`, body);

// ---------- F-SAF-01 ----------

describe('verified profiles (F-SAF-01)', () => {
  it('pose challenge → selfie → face match → review queue → approve; the selfie is deleted', async () => {
    const m = await member(h);
    const empty = (await api(m).get('/v1/verification').expect(200)).body as MyVerification;
    expect(empty).toMatchObject({
      status: 'none',
      verified: false,
      challenge: null,
      attemptsLeftToday: 3,
    });

    const started = (await api(m).post('/v1/verification/challenge').expect(200))
      .body as MyVerification;
    expect(started.challenge?.pose).toBeTruthy();
    expect(started.attemptsLeftToday).toBe(2);
    // Asking again returns the same open pose without spending another attempt.
    const again = (await api(m).post('/v1/verification/challenge').expect(200))
      .body as MyVerification;
    expect(again.challenge?.id).toBe(started.challenge?.id);
    expect(again.attemptsLeftToday).toBe(2);

    const challengeId = started.challenge?.id as string;
    const wrong = await upload(m, 'profile_photo');
    await api(m).post('/v1/verification/submit', { challengeId, mediaId: wrong }).expect(400);
    // Same bytes as the onboarding photo: the fake face matcher reports a strong match.
    const selfie = await upload(m, 'verification_selfie');
    const pending = (
      await api(m).post('/v1/verification/submit', { challengeId, mediaId: selfie }).expect(200)
    ).body as MyVerification;
    expect(pending).toMatchObject({ status: 'pending', challenge: null });
    const busy = await api(m).post('/v1/verification/challenge').expect(403);
    expect(busy.body.error.details).toMatchObject({ reason: 'VERIFICATION_PENDING' });

    await api(m).get('/v1/admin/verifications').expect(403);
    const queue = (await api(admin).get('/v1/admin/verifications?limit=50').expect(200))
      .body as AdminVerificationList;
    const item = queue.items.find((i) => i.user.id === m.id);
    expect(item).toMatchObject({ faceSimilarity: 95, pose: started.challenge?.pose });
    expect(item?.selfie?.md).toBeTruthy();
    expect(item?.profilePhotos.length).toBeGreaterThan(0);

    const id = item?.id as string;
    await api(admin)
      .post(`/v1/admin/verifications/${id}/review`, { decision: 'rejected' })
      .expect(400);
    await api(admin)
      .post(`/v1/admin/verifications/${id}/review`, { decision: 'approved' })
      .expect(200);
    const twice = await api(admin)
      .post(`/v1/admin/verifications/${id}/review`, { decision: 'approved' })
      .expect(409);
    expect(twice.body.error.details).toMatchObject({ reason: 'ALREADY_RESOLVED' });

    const me = (await api(m).get('/v1/me').expect(200)).body as MeResponse;
    expect(me.verified).toBe(true);
    const mine = (await api(m).get('/v1/verification').expect(200)).body as MyVerification;
    expect(mine).toMatchObject({ status: 'approved', verified: true });
    const { rows } = await h.pool.query<{ status: string; media: string | null }>(
      `SELECT a.status, v.media_asset_id AS media FROM media_assets a, verifications v
        WHERE a.id = $1 AND v.id = $2`,
      [selfie, id],
    );
    expect(rows[0]).toEqual({ status: 'deleted', media: null });
    const done = await api(m).post('/v1/verification/challenge').expect(403);
    expect(done.body.error.details).toMatchObject({ reason: 'ALREADY_VERIFIED' });
    const audit = await h.pool.query(
      "SELECT 1 FROM admin_actions WHERE action = 'verification.approve' AND target_id = $1",
      [m.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('a selfie never submitted is deleted after a day; a submitted one waits for review (D-163)', async () => {
    const m = await member(h);
    const abandoned = await upload(m, 'verification_selfie');
    const fresh = await upload(m, 'verification_selfie');
    await h.pool.query(
      `UPDATE media_assets SET created_at = now() - interval '25 hours' WHERE id = $1`,
      [abandoned],
    );
    expect(await h.app.get(VerificationService).purgeUnsubmittedSelfies()).toBeGreaterThanOrEqual(
      1,
    );
    const { rows } = await h.pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM media_assets WHERE id = ANY($1)',
      [[abandoned, fresh]],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [abandoned]: 'deleted',
      [fresh]: 'ready',
    });
  });

  it('rejections carry a reason; poses expire; three tries a day; a photo is needed first', async () => {
    const m = await member(h);
    const first = (await api(m).post('/v1/verification/challenge').expect(200))
      .body as MyVerification;
    const selfie = await upload(m, 'verification_selfie', await testJpeg(900, 900));
    await api(m)
      .post('/v1/verification/submit', { challengeId: first.challenge?.id, mediaId: selfie })
      .expect(200);
    const { rows } = await h.pool.query<{ id: string; face: number }>(
      'SELECT id, face_similarity AS face FROM verifications WHERE user_id = $1',
      [m.id],
    );
    expect(rows[0]?.face).toBe(40);
    await api(admin)
      .post(`/v1/admin/verifications/${rows[0]?.id}/review`, {
        decision: 'rejected',
        reason: 'FACE_MISMATCH',
      })
      .expect(200);
    const rejected = (await api(m).get('/v1/verification').expect(200)).body as MyVerification;
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectReason: 'FACE_MISMATCH',
      verified: false,
    });

    const second = (await api(m).post('/v1/verification/challenge').expect(200))
      .body as MyVerification;
    await h.pool.query(
      "UPDATE verifications SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [second.challenge?.id],
    );
    const late = await api(m)
      .post('/v1/verification/submit', {
        challengeId: second.challenge?.id,
        mediaId: await upload(m, 'verification_selfie'),
      })
      .expect(403);
    expect(late.body.error.details).toMatchObject({ reason: 'CHALLENGE_EXPIRED' });
    const third = (await api(m).post('/v1/verification/challenge').expect(200))
      .body as MyVerification;
    expect(third.attemptsLeftToday).toBe(0);
    await h.pool.query(
      "UPDATE verifications SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [third.challenge?.id],
    );
    const out = await api(m).post('/v1/verification/challenge').expect(403);
    expect(out.body.error.details).toMatchObject({ reason: 'NO_ATTEMPTS_LEFT' });
    await api(m)
      .post('/v1/verification/submit', { challengeId: randomUUID(), mediaId: selfie })
      .expect(404);

    const noPhoto = await member(h);
    await h.pool.query('DELETE FROM profile_photos WHERE user_id = $1', [noPhoto.id]);
    const blocked = await api(noPhoto).post('/v1/verification/challenge').expect(403);
    expect(blocked.body.error.details).toMatchObject({ reason: 'NEEDS_PROFILE_PHOTO' });
  });
});

// ---------- F-SAF-04, F-WEB-02 ----------

describe('trusted contacts (F-SAF-04)', () => {
  it('up to three, no duplicates, not your own number; only yours to remove', async () => {
    const m = await member(h);
    const other = await member(h);
    await api(m).post('/v1/safety/contacts', { name: 'Amma', phone: '12345' }).expect(400);
    const own = await api(m)
      .post('/v1/safety/contacts', { name: 'Me', phone: m.phone })
      .expect(403);
    expect(own.body.error.details).toMatchObject({ reason: 'OWN_NUMBER' });
    const phones = [contactPhone(), contactPhone(), contactPhone()];
    for (const [i, phone] of phones.entries())
      await api(m)
        .post('/v1/safety/contacts', { name: `Contact ${i}`, phone })
        .expect(200);
    const dup = await api(m)
      .post('/v1/safety/contacts', { name: 'Again', phone: phones[0] })
      .expect(403);
    expect(dup.body.error.details).toMatchObject({ reason: 'DUPLICATE_CONTACT' });
    const full = await api(m)
      .post('/v1/safety/contacts', { name: 'Fourth', phone: contactPhone() })
      .expect(403);
    expect(full.body.error.details).toMatchObject({ reason: 'CONTACTS_FULL' });
    const list = (await api(m).get('/v1/safety/contacts').expect(200)).body as TrustedContactList;
    expect(list.items.map((c) => c.phone)).toEqual(phones);
    const first = list.items[0]?.id as string;
    await api(other).del(`/v1/safety/contacts/${first}`).expect(404);
    const after = (await api(m).del(`/v1/safety/contacts/${first}`).expect(200))
      .body as TrustedContactList;
    expect(after.items).toHaveLength(2);
  });
});

async function withContacts(n = 2): Promise<{ m: Member; phones: string[] }> {
  const m = await member(h);
  const phones = Array.from({ length: n }, () => contactPhone());
  for (const phone of phones)
    await api(m).post('/v1/safety/contacts', { name: 'Friend', phone }).expect(200);
  return { m, phones };
}
const tokenOf = (link: string) => link.split('/l/')[1] as string;

describe('live location (F-SAF-04, F-WEB-02)', () => {
  it('contacts get a signed link; the page shows the latest spot until sharing stops', async () => {
    const lonely = await member(h);
    const none = await api(lonely).post('/v1/safety/live', { minutes: 60 }).expect(403);
    expect(none.body.error.details).toMatchObject({ reason: 'NO_CONTACTS' });

    const { m, phones } = await withContacts(2);
    await api(m).post('/v1/safety/live', { minutes: 5 }).expect(400);
    const started = (await api(m).post('/v1/safety/live', { minutes: 60 }).expect(200))
      .body as MyLiveShare;
    expect(started.share).toMatchObject({ active: true, contactsNotified: 2, eventId: null });
    const link = started.share?.link as string;
    expect(link).toMatch(/\/l\/[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
    for (const phone of phones) {
      const sms = h.sms.sent.find((s) => s.to === phone && s.kind === 'live_location_share');
      expect(sms?.body).toContain(link);
    }
    const again = await api(m).post('/v1/safety/live', { minutes: 60 }).expect(403);
    expect(again.body.error.details).toMatchObject({ reason: 'SHARE_ACTIVE' });

    const token = tokenOf(link);
    const waiting = (await view(token).expect(200)).body as PublicLiveView;
    expect(waiting).toMatchObject({
      status: 'active',
      sos: false,
      lastPoint: null,
      trail: [],
      event: null,
    });
    expect(waiting.name).toBe('Test Person');

    await api(m)
      .post('/v1/safety/live/points', { lat: 17.44, lng: 78.35, accuracy: 12 })
      .expect(200);
    const moved = (
      await api(m).post('/v1/safety/live/points', { lat: 17.45, lng: 78.36 }).expect(200)
    ).body as MyLiveShare;
    expect(moved.share?.lastPointAt).toBeTruthy();
    const live = (await view(token).expect(200)).body as PublicLiveView;
    expect(live.lastPoint).toMatchObject({ lat: 17.45, lng: 78.36, accuracy: null });
    expect(live.trail.map((p) => p.lat)).toEqual([17.44, 17.45]);
    expect((await api(m).get('/v1/safety/live').expect(200)).body).toMatchObject({
      share: { active: true },
    });

    // Tampered or malformed links show nothing.
    const [id, exp] = token.split('.');
    await view(`${id}.${exp}.${'A'.repeat(43)}`).expect(404);
    await view(`${id}.${Number(exp) + 60}.${token.split('.')[2]}`).expect(404);
    await view('not-a-token').expect(400);

    await api(m).post('/v1/safety/live/stop').expect(200);
    const ended = (await view(token).expect(200)).body as PublicLiveView;
    expect(ended).toMatchObject({ status: 'ended', lastPoint: null, trail: [] });
    const gone = await api(m).post('/v1/safety/live/points', { lat: 17.4, lng: 78.3 }).expect(403);
    expect(gone.body.error.details).toMatchObject({ reason: 'NO_ACTIVE_SHARE' });
    expect((await api(m).get('/v1/safety/live').expect(200)).body).toEqual({ share: null });
  });

  it('a plan can be shared around its time; the page shows it as the sharer sees it', async () => {
    const host = await verifiedMember(h);
    const { m } = await withContacts(1);
    await befriend(h, host, m);
    const event = await plot(h, host, { mystery: true, mysteryRevealMinutesBefore: 30 });
    await request(h.http)
      .put(`/v1/events/${event.id}/rsvp`)
      .set(...bearer(m.token))
      .set(...idem())
      .send({ status: 'going' })
      .expect(200);
    const early = await api(m)
      .post('/v1/safety/live', { eventId: event.id, minutes: 60 })
      .expect(403);
    expect(early.body.error.details).toMatchObject({ reason: 'OUTSIDE_EVENT_WINDOW' });
    await shiftEvent(h, event.id, 90 * 60_000);
    const started = (
      await api(m).post('/v1/safety/live', { eventId: event.id, minutes: 120 }).expect(200)
    ).body as MyLiveShare;
    const page = (await view(tokenOf(started.share?.link as string)).expect(200))
      .body as PublicLiveView;
    expect(page.event).toMatchObject({ title: event.title, startsAt: expect.any(String) });
    // The spot isn't revealed to the sharer yet, so the page doesn't reveal it either.
    expect(JSON.stringify(page)).not.toContain(ADDRESS);
    const stranger = await withContacts(1);
    const notGoing = await api(stranger.m)
      .post('/v1/safety/live', { eventId: event.id, minutes: 60 })
      .expect(403);
    expect(notGoing.body.error.details).toMatchObject({ reason: 'NOT_GOING' });
    await api(stranger.m)
      .post('/v1/safety/live', { eventId: randomUUID(), minutes: 60 })
      .expect(404);
  });

  it('ends by itself, then every trace is purged within 24 hours', async () => {
    const { m } = await withContacts(1);
    const started = (await api(m).post('/v1/safety/live', { minutes: 30 }).expect(200))
      .body as MyLiveShare;
    await api(m).post('/v1/safety/live/points', { lat: 17.4, lng: 78.4 }).expect(200);
    const id = started.share?.id as string;
    await h.pool.query(
      "UPDATE live_location_shares SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    const safety = h.app.get(SafetyService);
    expect(await safety.endExpired()).toBeGreaterThanOrEqual(1);
    expect((await api(m).get('/v1/safety/live').expect(200)).body).toEqual({ share: null });
    const token = tokenOf(started.share?.link as string);
    expect((await view(token).expect(200)).body).toMatchObject({ status: 'ended' });

    await h.pool.query(
      "UPDATE live_location_points SET recorded_at = now() - interval '23 hours 30 minutes' WHERE share_id = $1",
      [id],
    );
    await h.pool.query(
      "UPDATE live_location_shares SET ended_at = now() - interval '23 hours 30 minutes' WHERE id = $1",
      [id],
    );
    expect(await safety.purge()).toBeGreaterThanOrEqual(2);
    const { rows } = await h.pool.query<{ n: number }>(
      `SELECT (SELECT count(*)::int FROM live_location_points WHERE share_id = $1)
            + (SELECT count(*)::int FROM live_location_shares WHERE id = $1) AS n`,
      [id],
    );
    expect(rows[0]?.n).toBe(0);
    await view(token).expect(404);
  });

  it('starts are serialised: two at once give one share', async () => {
    const { m } = await withContacts(1);
    const results = await Promise.all([
      api(m).post('/v1/safety/live', { minutes: 30 }),
      api(m).post('/v1/safety/live', { minutes: 30 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const { rows } = await h.pool.query(
      'SELECT 1 FROM live_location_shares WHERE user_id = $1 AND ended_at IS NULL',
      [m.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('the live_location flag switches sharing off, but never SOS', async () => {
    const { m, phones } = await withContacts(2);
    const flags = h.app.get(FeatureFlagsService);
    await flags.set('live_location', false);
    try {
      const off = await api(m).post('/v1/safety/live', { minutes: 30 }).expect(403);
      expect(off.body.error.code).toBe('FEATURE_DISABLED');
      const sos = (
        await api(m)
          .post('/v1/safety/sos', { point: { lat: 17.41, lng: 78.44 } })
          .expect(200)
      ).body as MyLiveShare;
      expect(sos.share).toMatchObject({ active: true, contactsNotified: 2 });
      expect(sos.share?.sosAt).toBeTruthy();
      for (const phone of phones)
        expect(h.sms.sent.some((s) => s.to === phone && s.kind === 'sos_alert')).toBe(true);
      const page = (await view(tokenOf(sos.share?.link as string)).expect(200))
        .body as PublicLiveView;
      expect(page).toMatchObject({ sos: true, lastPoint: { lat: 17.41, lng: 78.44 } });
    } finally {
      await flags.set('live_location', true);
    }
  });

  it('SOS during a share marks it; SOS with no contacts still answers', async () => {
    const { m } = await withContacts(1);
    const started = (await api(m).post('/v1/safety/live', { minutes: 30 }).expect(200))
      .body as MyLiveShare;
    const sos = (await api(m).post('/v1/safety/sos', {}).expect(200)).body as MyLiveShare;
    expect(sos.share?.id).toBe(started.share?.id);
    expect(sos.share?.sosAt).toBeTruthy();
    const alone = await member(h);
    const quiet = (await api(alone).post('/v1/safety/sos', {}).expect(200)).body as MyLiveShare;
    expect(quiet.share).toMatchObject({ contactsNotified: 0, active: true });
  });
});

// ---------- F-SAF-06 holds + F-SAF-05 tools ----------

async function dm(a: Member, b: Member): Promise<string> {
  await befriend(h, a, b);
  const conv = await request(h.http)
    .post('/v1/chats/direct')
    .set(...bearer(a.token))
    .send({ userId: b.id })
    .expect(201);
  return (conv.body as ConversationSummary).id;
}
const say = (m: Member, conversationId: string, body: string) =>
  request(h.http)
    .post(`/v1/chats/${conversationId}/messages`)
    .set(...bearer(m.token))
    .send({ clientId: randomUUID(), kind: 'text', body });
const messages = async (m: Member, conversationId: string): Promise<Message[]> =>
  ((await api(m).get(`/v1/chats/${conversationId}/messages`).expect(200)).body as MessagePage)
    .items;

describe('text filter holds (F-SAF-06) and moderator actions (F-SAF-05)', () => {
  it('a flagged message is only seen by its sender until released', async () => {
    const [a, b] = [await member(h), await member(h)];
    const conv = await dm(a, b);
    const held = (await say(a, conv, 'nee lanja').expect(201)).body as Message;
    expect(held).toMatchObject({ held: true, body: 'nee lanja' });
    await say(a, conv, 'see you at 6').expect(201);
    expect((await messages(b, conv)).map((x) => x.body)).toEqual(['see you at 6']);
    expect((await messages(a, conv)).map((x) => x.held)).toEqual([false, true]);
    // Not even by id (D-163).
    await api(b).get(`/v1/chats/${conv}/messages/${held.id}`).expect(404);
    await api(a).get(`/v1/chats/${conv}/messages/${held.id}`).expect(200);

    const itemId = await openItem('message', held.id);
    await api(a).get(`/v1/admin/moderation/items/${itemId}`).expect(403);
    const item = (await api(admin).get(`/v1/admin/moderation/items/${itemId}`).expect(200))
      .body as ModerationItemDetail;
    expect(item).toMatchObject({
      source: 'auto_text',
      severity: 'high',
      details: { matches: ['lanja'] },
      preview: { text: 'nee lanja', owner: { id: a.id, displayName: 'Test Person' }, gone: false },
    });
    const done = (
      await resolve(itemId, { outcome: 'dismiss', note: 'Banter between friends' }).expect(200)
    ).body as ModerationItemDetail;
    expect(done.status).toBe('dismissed');
    expect((await messages(b, conv)).map((x) => x.body)).toContain('nee lanja');
    const twice = await resolve(itemId, { outcome: 'dismiss' }).expect(409);
    expect(twice.body.error.details).toMatchObject({ reason: 'ALREADY_RESOLVED' });
  });

  it('taking a message down can mute its sender; mutes block posting until lifted', async () => {
    const [a, b] = [await member(h), await member(h)];
    const conv = await dm(a, b);
    const held = (await say(a, conv, 'you chutiya').expect(201)).body as Message;
    const itemId = await openItem('message', held.id);
    await resolve(itemId, {
      outcome: 'remove',
      sanction: { kind: 'mute', reason: 'Abuse in chat' },
    }).expect(400);
    const done = (
      await resolve(itemId, {
        outcome: 'remove',
        sanction: { kind: 'mute', days: 1, reason: 'Abuse in chat' },
      }).expect(200)
    ).body as ModerationItemDetail;
    expect(done).toMatchObject({ status: 'actioned', preview: { gone: true } });
    expect((await messages(a, conv)).find((x) => x.id === held.id)).toMatchObject({
      deleted: true,
      body: null,
    });

    const muted = await say(a, conv, 'hello?').expect(403);
    expect(muted.body.error.details).toMatchObject({ reason: 'MUTED', until: expect.any(String) });
    const me = (await api(a).get('/v1/me').expect(200)).body as MeResponse;
    expect(me.mutedUntil).toBeTruthy();
    const plotBlocked = await request(h.http)
      .post('/v1/events')
      .set(...bearer(a.token))
      .set(...idem())
      .send(await planBody(h))
      .expect(403);
    expect(plotBlocked.body.error.details).toMatchObject({ reason: 'MUTED' });

    const detail = (await api(admin).get(`/v1/admin/users/${a.id}`).expect(200))
      .body as AdminUserDetail;
    expect(detail.mutedUntil).toBeTruthy();
    const mute = detail.sanctions.find((s) => s.kind === 'mute');
    expect(mute).toMatchObject({ reason: 'Abuse in chat', byName: 'Test Person', liftedAt: null });
    await api(admin).post(`/v1/admin/sanctions/${mute?.id}/lift`).expect(200);
    await api(admin).post(`/v1/admin/sanctions/${mute?.id}/lift`).expect(409);
    await say(a, conv, 'sorry about that').expect(201);
  });

  it('bios are held, names refused; a flagged plan stays with its hosts until released', async () => {
    const a = await verifiedMember(h);
    const b = await member(h);
    await api(a).patch('/v1/me/profile', { displayName: 'Bhenchod' }).expect(400);
    await api(a).patch('/v1/me/profile', { bio: 'Not a harami, promise' }).expect(200);
    expect(((await api(a).get('/v1/me').expect(200)).body as MeResponse).bioHeld).toBe(true);
    const seen = (await api(b).get(`/v1/users/${a.id}/profile`).expect(200)).body as PublicProfile;
    expect(seen.bio).toBe('');
    await resolve(await openItem('user', a.id), { outcome: 'remove' }).expect(200);
    expect((await api(a).get('/v1/me').expect(200)).body as MeResponse).toMatchObject({
      bio: '',
      bioHeld: false,
    });

    const event = await plot(h, a, { title: 'Bitch about Mondays' });
    await api(a).get(`/v1/events/${event.id}`).expect(200);
    await api(b).get(`/v1/events/${event.id}`).expect(404);
    await request(h.http)
      .get(`/v1/public/events/${event.slug}`)
      .set(...fromIp())
      .expect(404);
    expect(await outboxFor(h, event.id, 'event.created')).toHaveLength(0);
    await resolve(await openItem('event', event.id), { outcome: 'dismiss' }).expect(200);
    await api(b).get(`/v1/events/${event.id}`).expect(200);
    expect(await outboxFor(h, event.id, 'event.created')).toHaveLength(1);

    const bad = await plot(h, a, { description: 'kill yourself if you are late' });
    await resolve(await openItem('event', bad.id), { outcome: 'remove' }).expect(200);
    const after = (await api(a).get(`/v1/events/${bad.id}`).expect(200)).body as EventDetail;
    expect(after.status).toBe('cancelled');
  });

  it('crews and plan votes are held from everyone but their people', async () => {
    const a = await member(h);
    const b = await member(h);
    await befriend(h, a, b);
    const [interestId] = await interestIds(h, 1);
    const crew = (
      await api(a)
        .post('/v1/crews', { name: 'Gandu gang runs', description: 'Easy 5k', interestId })
        .expect(201)
    ).body as CrewDetail;
    expect(crew.held).toBe(true);
    await api(b).get(`/v1/crews/${crew.id}`).expect(404);
    const discover = (await api(b).get('/v1/crews?scope=discover&limit=50').expect(200))
      .body as CrewList;
    expect(discover.items.some((c) => c.id === crew.id)).toBe(false);
    await resolve(await openItem('crew', crew.id), { outcome: 'dismiss' }).expect(200);
    await api(b).get(`/v1/crews/${crew.id}`).expect(200);

    const [categoryInterestId] = await interestIds(h, 1);
    const proposal = (
      await api(a)
        .post('/v1/proposals', {
          title: 'Shit movie night',
          categoryInterestId,
          inviteeIds: [b.id],
          deadline: new Date(Date.now() + DAY).toISOString(),
        })
        .expect(201)
    ).body as ProposalDetail;
    expect(proposal.held).toBe(true);
    await api(b).get(`/v1/proposals/${proposal.id}`).expect(404);
    await api(a)
      .post(`/v1/proposals/${proposal.id}/options`, { kind: 'activity', label: 'fuck it' })
      .expect(400);
    await resolve(await openItem('proposal', proposal.id), { outcome: 'remove' }).expect(200);
    const removed = (await api(a).get(`/v1/proposals/${proposal.id}`).expect(200))
      .body as ProposalDetail;
    expect(removed.status).toBe('cancelled');
  });

  it('flagged images can be released after review', async () => {
    const a = await member(h);
    const id = await upload(a, 'chat');
    // As the media processor does when the image adapter flags an upload.
    await h.pool.query("UPDATE media_assets SET status = 'flagged' WHERE id = $1", [id]);
    await h.app.get(ModerationService).flag({
      targetType: 'media_asset',
      targetId: id,
      source: 'auto_image',
      severity: 'high',
      details: { labels: [{ name: 'Explicit', confidence: 97 }] },
    });
    const itemId = await openItem('media_asset', id);
    const item = (await api(admin).get(`/v1/admin/moderation/items/${itemId}`).expect(200))
      .body as ModerationItemDetail;
    expect(item.preview).toMatchObject({ owner: { id: a.id, displayName: 'Test Person' } });
    await resolve(itemId, { outcome: 'dismiss' }).expect(200);
    const second = await upload(a, 'chat');
    await h.pool.query("UPDATE media_assets SET status = 'flagged' WHERE id = $1", [second]);
    await h.app.get(ModerationService).flag({
      targetType: 'media_asset',
      targetId: second,
      source: 'auto_image',
      severity: 'high',
    });
    await resolve(await openItem('media_asset', second), { outcome: 'remove' }).expect(200);
    const { rows } = await h.pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM media_assets WHERE id = ANY($1::uuid[])',
      [[id, second]],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [id]: 'ready',
      [second]: 'deleted',
    });
  });
});

describe('sanctions and the users page (F-SAF-05, F-WEB-03)', () => {
  it('suspensions lock people out until they end; bans until lifted; staff are off-limits', async () => {
    const a = await member(h);
    const sanction = (body: object) => api(admin).post(`/v1/admin/users/${a.id}/sanctions`, body);
    await sanction({ kind: 'warn', reason: 'Late cancels again' }).expect(200);
    await sanction({ kind: 'suspend', reason: 'Harassment report', days: 3 }).expect(200);
    const locked = await api(a).get('/v1/me');
    expect([401, 403]).toContain(locked.status);
    await api(admin)
      .post(`/v1/admin/users/${admin.id}/sanctions`, { kind: 'ban', reason: 'test' })
      .expect(403);
    const staff = await member(h);
    await h.app.get(UsersService).grantRole(staff.id, 'support', null);
    const refused = await api(admin)
      .post(`/v1/admin/users/${staff.id}/sanctions`, { kind: 'warn', reason: 'Nope' })
      .expect(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'STAFF_ACCOUNT' });

    await h.pool.query(
      "UPDATE user_sanctions SET until = now() - interval '1 minute' WHERE user_id = $1 AND kind = 'suspend'",
      [a.id],
    );
    expect(await h.app.get(SanctionsService).liftExpired()).toBeGreaterThanOrEqual(1);
    let detail = (await api(admin).get(`/v1/admin/users/${a.id}`).expect(200))
      .body as AdminUserDetail;
    expect(detail).toMatchObject({ status: 'active', suspendedUntil: null });
    expect(detail.sanctions.map((s) => s.kind)).toEqual(['suspend', 'warn']);

    detail = (await sanction({ kind: 'ban', reason: 'Repeated harassment' }).expect(200))
      .body as AdminUserDetail;
    expect(detail.status).toBe('banned');
    const ban = detail.sanctions.find((s) => s.kind === 'ban');
    detail = (await api(admin).post(`/v1/admin/sanctions/${ban?.id}/lift`).expect(200))
      .body as AdminUserDetail;
    expect(detail.status).toBe('active');
    const actions = await h.pool.query<{ action: string }>(
      "SELECT action FROM admin_actions WHERE target_id = $1 AND action LIKE 'users.%' ORDER BY created_at",
      [a.id],
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      'users.warn',
      'users.suspend',
      'users.ban',
      'users.lift_sanction',
    ]);
  });

  it('find people by ID, phone or name; badges can be granted and revoked by hand', async () => {
    const a = await member(h);
    await api(a).patch('/v1/me/profile', { displayName: 'Zubeida Quasar' }).expect(200);
    await api(a).get('/v1/admin/users?q=Zubeida').expect(403);
    const byName = (await api(admin).get('/v1/admin/users?q=Zubeida%20Quasar').expect(200))
      .body as AdminUserList;
    expect(byName.items.map((u) => u.id)).toContain(a.id);
    const byPhone = (
      await api(admin)
        .get(`/v1/admin/users?q=${encodeURIComponent(a.phone)}`)
        .expect(200)
    ).body as AdminUserList;
    expect(byPhone.items).toEqual([
      expect.objectContaining({ id: a.id, phoneLast4: a.phone.slice(-4), verified: false }),
    ]);
    const byId = (await api(admin).get(`/v1/admin/users?q=${a.id}`).expect(200))
      .body as AdminUserList;
    expect(byId.items).toHaveLength(1);
    await api(admin).get(`/v1/admin/users?q=${randomUUID()}`).expect(200);
    await api(admin).get(`/v1/admin/users/${randomUUID()}`).expect(404);

    let detail = (
      await api(admin).post(`/v1/admin/users/${a.id}/verification`, { verified: true }).expect(200)
    ).body as AdminUserDetail;
    expect(detail).toMatchObject({ verified: true, reportsAgainst: 0, roles: [] });
    expect(detail.person?.id).toBe(a.id);
    detail = (
      await api(admin).post(`/v1/admin/users/${a.id}/verification`, { verified: false }).expect(200)
    ).body as AdminUserDetail;
    expect(detail.verified).toBe(false);
  });
});

describe('safety data in export and erase (DPDP)', () => {
  it('contacts, shares and verification attempts are exported, then erased with the account', async () => {
    const { m } = await withContacts(1);
    await api(m).post('/v1/safety/live', { minutes: 30 }).expect(200);
    await api(m).post('/v1/safety/live/points', { lat: 17.4, lng: 78.4 }).expect(200);
    await api(m).post('/v1/verification/challenge').expect(200);
    const exported = (await api(m).get('/v1/me/export').expect(200)).body as Record<
      string,
      unknown
    >;
    const text = JSON.stringify(exported);
    for (const needle of ['trustedContacts', 'liveLocationPoints', 'verifications'])
      expect(text).toContain(needle);

    await api(m).post('/v1/me/deletion', { confirm: 'DELETE' }).expect(202);
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
      [m.id],
    );
    await h.app.get(AccountService).purgeDue();
    const { rows } = await h.pool.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM trusted_contacts WHERE user_id = $1) AS contacts,
              (SELECT count(*)::int FROM live_location_shares WHERE user_id = $1) AS shares,
              (SELECT count(*)::int FROM verifications WHERE user_id = $1) AS verifications`,
      [m.id],
    );
    expect(rows[0]).toEqual({ contacts: 0, shares: 0, verifications: 0 });
  });
});
