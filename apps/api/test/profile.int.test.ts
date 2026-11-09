import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeModerationProvider } from '../src/adapters/moderation/fake.moderation.js';
import type { ImageModerationResult } from '../src/adapters/moderation/moderation.port.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { MediaProcessor } from '../src/modules/media/media.processor.js';
import { MediaService } from '../src/modules/media/media.service.js';
import {
  bearer,
  cityAndHood,
  createHarness,
  device,
  fromIp,
  type Harness,
  interestIds,
  onboard,
  requestOtp,
  signIn,
  testJpeg,
  uploadPhoto,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('onboarding (F-ACC-04)', () => {
  it('tracks each step and activates the account only when complete', async () => {
    const s = await signIn(h);
    const me0 = await request(h.http)
      .get('/v1/me')
      .set(...bearer(s.accessToken))
      .expect(200);
    expect(me0.body.onboarding).toEqual({
      name: false,
      photos: false,
      dateOfBirth: false,
      city: false,
      interests: false,
      complete: false,
    });
    const early = await request(h.http)
      .post('/v1/me/onboarding/complete')
      .set(...bearer(s.accessToken))
      .expect(409);
    expect(early.body.error.code).toBe('ONBOARDING_INCOMPLETE');

    const tooFew = await request(h.http)
      .put('/v1/me/interests')
      .set(...bearer(s.accessToken))
      .send({ interestIds: await interestIds(h, 2) })
      .expect(400);
    expect(tooFew.body.error.code).toBe('VALIDATION_FAILED');

    await onboard(h, s.accessToken);
    const me = await request(h.http)
      .get('/v1/me')
      .set(...bearer(s.accessToken))
      .expect(200);
    expect(me.body).toMatchObject({
      status: 'active',
      displayName: 'Test Person',
      onboarding: { complete: true },
      stats: { reliabilityTier: 'new' },
    });
    expect(me.body.phoneMasked).toMatch(/^\+91•+\d\d$/);
    expect(me.body.photos[0]).toMatchObject({
      status: 'ready',
      urls: { sm: expect.stringContaining('sm.webp') as string },
    });
  });

  it('validates city/neighbourhood pairs and unknown taxonomy ids', async () => {
    const s = await signIn(h);
    const { cityId } = await cityAndHood(h);
    const bad = await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(s.accessToken))
      .send({ cityId, neighbourhoodId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await request(h.http)
      .put('/v1/me/interests')
      .set(...bearer(s.accessToken))
      .send({ interestIds: ['0192f3a4-5b6c-7d8e-9f01-23456789abcd', ...(await interestIds(h, 2))] })
      .expect(400);
    await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(s.accessToken))
      .send({})
      .expect(400);
    await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(s.accessToken))
      .send({ dateOfBirth: '2999-01-01' })
      .expect(400);
  });

  it('records vibes (max 5), tutorial completion and replay', async () => {
    const s = await signIn(h);
    const vibes = (await request(h.http).get('/v1/vibe-tags').expect(200)).body.items.map(
      (v: { id: string }) => v.id,
    ) as string[];
    await request(h.http)
      .put('/v1/me/vibe-tags')
      .set(...bearer(s.accessToken))
      .send({ vibeTagIds: vibes.slice(0, 6) })
      .expect(400);
    const ok = await request(h.http)
      .put('/v1/me/vibe-tags')
      .set(...bearer(s.accessToken))
      .send({ vibeTagIds: vibes.slice(0, 2) })
      .expect(200);
    expect(ok.body.items).toHaveLength(2);
    await request(h.http)
      .post('/v1/me/tutorial/complete')
      .set(...bearer(s.accessToken))
      .expect(204);
    expect(
      (
        await request(h.http)
          .get('/v1/me')
          .set(...bearer(s.accessToken))
      ).body.tutorialComplete,
    ).toBe(true);
    await request(h.http)
      .delete('/v1/me/tutorial')
      .set(...bearer(s.accessToken))
      .expect(204);
    expect(
      (
        await request(h.http)
          .get('/v1/me')
          .set(...bearer(s.accessToken))
      ).body.tutorialComplete,
    ).toBe(false);
  });
});

describe('age gate (F-ACC-03)', () => {
  it('blocks under-18s, erases their data and refuses the number afterwards', async () => {
    const s = await signIn(h);
    await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(s.accessToken))
      .send({ displayName: 'Kid' })
      .expect(200);
    const dob = new Date(Date.now() - 17 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(s.accessToken))
      .send({ dateOfBirth: dob })
      .expect(403);
    expect(res.body.error.code).toBe('AGE_RESTRICTED');
    const { rows } = await h.pool.query<{ status: string; phone_e164: string | null }>(
      'SELECT status, phone_e164 FROM users WHERE id = $1',
      [s.user.id],
    );
    expect(rows[0]).toEqual({ status: 'age_blocked', phone_e164: null });
    expect(
      (await h.pool.query('SELECT 1 FROM profiles WHERE user_id = $1', [s.user.id])).rows,
    ).toHaveLength(0);
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(s.accessToken))
      .expect(401);
    const code = await requestOtp(h, s.phone);
    const again = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone: s.phone, code, device: device() })
      .expect(403);
    expect(again.body.error.code).toBe('AGE_RESTRICTED');
  });
});

describe('media pipeline (F-ACC-06)', () => {
  it('resizes to three webp sizes and strips all EXIF', async () => {
    const s = await signIn(h);
    const original = await testJpeg(2400, 1800, true);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const assetId = await uploadPhoto(h, s.accessToken, original);
    const asset = await h.app.get(MediaService).byId(assetId);
    expect(asset).toMatchObject({ status: 'ready', width: 1080, height: 810 });
    for (const [key, edge] of [
      ['sm', 160],
      ['md', 480],
      ['lg', 1080],
    ] as const) {
      if (!asset?.variantKeys) throw new Error('variants missing');
      const variant = await h.storage.get(asset.variantKeys[key]);
      const meta = await sharp(variant).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width, meta.height)).toBe(edge);
      expect(meta.exif).toBeUndefined();
    }
    expect(await h.storage.head(asset?.originalKey ?? '')).toBeNull();
    expect(await h.app.get(MediaProcessor).process(assetId)).toBe('skipped');
  });

  it('enforces ownership, completion and type rules', async () => {
    const a = await signIn(h);
    const b = await signIn(h);
    const assetId = await uploadPhoto(h, a.accessToken);
    await request(h.http)
      .get(`/v1/media/${assetId}`)
      .set(...bearer(a.accessToken))
      .expect(200);
    // Only the uploader reads an asset directly; others get it through the content that holds it (D-163).
    await request(h.http)
      .get(`/v1/media/${assetId}`)
      .set(...bearer(b.accessToken))
      .expect(404);
    await request(h.http)
      .put('/v1/me/photos')
      .set(...bearer(b.accessToken))
      .send({ mediaAssetIds: [assetId] })
      .expect(404);
    await request(h.http)
      .post(`/v1/media/${assetId}/complete`)
      .set(...bearer(b.accessToken))
      .expect(404);
    const pending = await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(a.accessToken))
      .send({ purpose: 'profile_photo', contentType: 'image/jpeg', sizeBytes: 100 })
      .expect(201);
    const notUploaded = await request(h.http)
      .post(`/v1/media/${pending.body.assetId}/complete`)
      .set(...bearer(a.accessToken))
      .expect(409);
    expect(notUploaded.body.error.code).toBe('CONFLICT');
    expect(
      (
        await request(h.http)
          .put('/v1/me/photos')
          .set(...bearer(a.accessToken))
          .send({ mediaAssetIds: [pending.body.assetId] })
          .expect(409)
      ).body.error.code,
    ).toBe('MEDIA_NOT_READY');
    await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(a.accessToken))
      .send({ purpose: 'profile_photo', contentType: 'image/gif', sizeBytes: 100 })
      .expect(400);
    await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(a.accessToken))
      .send({ purpose: 'profile_photo', contentType: 'image/jpeg', sizeBytes: 50_000_000 })
      .expect(400);
  });

  it('rejects files that are not images', async () => {
    const s = await signIn(h);
    const created = await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(s.accessToken))
      .send({ purpose: 'profile_photo', contentType: 'image/jpeg', sizeBytes: 20 })
      .expect(201);
    h.storage.simulateUpload(
      created.body.upload.fields.key as string,
      Buffer.from('definitely not a jpeg'),
      'image/jpeg',
    );
    await request(h.http)
      .post(`/v1/media/${created.body.assetId}/complete`)
      .set(...bearer(s.accessToken))
      .expect(200);
    expect(await h.app.get(MediaProcessor).process(created.body.assetId as string)).toBe(
      'rejected',
    );
  });

  it('replacing photos deletes the removed ones from storage, keeping order', async () => {
    const s = await signIn(h);
    const [p1, p2, p3] = [
      await uploadPhoto(h, s.accessToken),
      await uploadPhoto(h, s.accessToken),
      await uploadPhoto(h, s.accessToken),
    ];
    await request(h.http)
      .put('/v1/me/photos')
      .set(...bearer(s.accessToken))
      .send({ mediaAssetIds: [p1, p2, p3] })
      .expect(200);
    const res = await request(h.http)
      .put('/v1/me/photos')
      .set(...bearer(s.accessToken))
      .send({ mediaAssetIds: [p3, p1] })
      .expect(200);
    expect(res.body.photos.map((p: { mediaAssetId: string }) => p.mediaAssetId)).toEqual([p3, p1]);
    const removed = await h.app.get(MediaService).byId(p2);
    expect(removed?.status).toBe('deleted');
    await request(h.http)
      .put('/v1/me/photos')
      .set(...bearer(s.accessToken))
      .send({ mediaAssetIds: [p1, p1] })
      .expect(400);
  });
});

describe('flagged images are held for review (F-SAF-06)', () => {
  it('queues a moderation item and hides the image from others', async () => {
    class FlagEverything extends FakeModerationProvider {
      override moderateImage(): Promise<ImageModerationResult> {
        return Promise.resolve({
          verdict: 'flagged',
          labels: [{ name: 'Explicit', confidence: 97 }],
        });
      }
    }
    const strict = await createHarness({ moderation: new FlagEverything() });
    try {
      const s = await signIn(strict);
      const assetId = await uploadPhoto(strict, s.accessToken);
      const mine = await request(strict.http)
        .get(`/v1/media/${assetId}`)
        .set(...bearer(s.accessToken))
        .expect(200);
      expect(mine.body.status).toBe('flagged');
      const other = await signIn(strict);
      await request(strict.http)
        .get(`/v1/media/${assetId}`)
        .set(...bearer(other.accessToken))
        .expect(404);
      const { rows } = await strict.pool.query(
        "SELECT severity, status FROM moderation_items WHERE target_id = $1 AND source = 'auto_image'",
        [assetId],
      );
      expect(rows).toEqual([{ severity: 'high', status: 'open' }]);
      await request(strict.http)
        .put('/v1/me/photos')
        .set(...bearer(s.accessToken))
        .send({ mediaAssetIds: [assetId] })
        .expect(400);
    } finally {
      await strict.close();
    }
  });
});

describe('profiles and privacy (F-ACC-05)', () => {
  it('shows age, shared interests and neighbourhood, never DOB or gender', async () => {
    const a = await signIn(h);
    const b = await signIn(h);
    await onboard(h, a.accessToken, {
      displayName: 'Priya R.',
      bio: 'Sunrise trekker',
      pronouns: 'she/her',
    });
    await onboard(h, b.accessToken, { displayName: 'Rohan K.' });
    const res = await request(h.http)
      .get(`/v1/users/${a.user.id}/profile`)
      .set(...bearer(b.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      displayName: 'Priya R.',
      bio: 'Sunrise trekker',
      pronouns: 'she/her',
      limited: false,
      neighbourhoodName: expect.any(String) as string,
    });
    expect(res.body.age).toBeGreaterThanOrEqual(18);
    expect(res.body.sharedInterestIds).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toMatch(/dateOfBirth|1998-05-20|gender|woman/);
    expect(res.body.photos[0].md).toContain('md.webp');
  });

  it('squad-only and friends-of-friends profiles show strangers only a limited card', async () => {
    const a = await signIn(h);
    const b = await signIn(h);
    await onboard(h, a.accessToken, { displayName: 'Private P.', bio: 'secret bio' });
    await onboard(h, b.accessToken);
    for (const visibility of ['squad_only', 'friends_of_friends']) {
      await request(h.http)
        .put('/v1/me/settings/privacy')
        .set(...bearer(a.accessToken))
        .send({ profileVisibility: visibility })
        .expect(200);
      const res = await request(h.http)
        .get(`/v1/users/${a.user.id}/profile`)
        .set(...bearer(b.accessToken))
        .expect(200);
      expect(res.body).toMatchObject({
        limited: true,
        bio: '',
        age: null,
        interests: [],
        neighbourhoodName: null,
      });
      expect(res.body.photos.length).toBeLessThanOrEqual(1);
    }
    const self = await request(h.http)
      .get(`/v1/users/${a.user.id}/profile`)
      .set(...bearer(a.accessToken))
      .expect(200);
    expect(self.body).toMatchObject({ limited: false, bio: 'secret bio' });
  });

  it('profiles of non-active accounts are not found', async () => {
    const viewer = await signIn(h);
    await onboard(h, viewer.accessToken);
    const pending = await signIn(h);
    await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(pending.accessToken))
      .send({ displayName: 'Halfway' })
      .expect(200);
    await request(h.http)
      .get(`/v1/users/${pending.user.id}/profile`)
      .set(...bearer(viewer.accessToken))
      .expect(404);
    await request(h.http)
      .get('/v1/users/0192f3a4-5b6c-7d8e-9f01-23456789abcd/profile')
      .set(...bearer(viewer.accessToken))
      .expect(404);
  });
});

describe('settings (F-ACC-07)', () => {
  it('notification preferences default sensibly and safety stays on', async () => {
    const s = await signIn(h);
    const defaults = await request(h.http)
      .get('/v1/me/settings/notifications')
      .set(...bearer(s.accessToken))
      .expect(200);
    expect(
      defaults.body.items.find((p: { category: string }) => p.category === 'marketing'),
    ).toEqual({ category: 'marketing', push: false, inApp: true });
    const updated = await request(h.http)
      .put('/v1/me/settings/notifications')
      .set(...bearer(s.accessToken))
      .send({
        items: [
          { category: 'squad', push: false, inApp: true },
          { category: 'safety', push: false, inApp: false },
        ],
      })
      .expect(200);
    const byCat = Object.fromEntries(
      (updated.body.items as { category: string; push: boolean }[]).map((p) => [
        p.category,
        p.push,
      ]),
    );
    expect(byCat).toMatchObject({ squad: false, safety: true, chat: true });
  });

  it('privacy, language, consents and push devices', async () => {
    const s = await signIn(h);
    const privacy = await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(s.accessToken))
      .send({ readReceipts: false })
      .expect(200);
    expect(privacy.body).toMatchObject({
      readReceipts: false,
      profileVisibility: 'everyone',
      showFirstTimerBadge: true,
    });
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(s.accessToken))
      .send({})
      .expect(400);
    await request(h.http)
      .put('/v1/me/settings/language')
      .set(...bearer(s.accessToken))
      .send({ language: 'te' })
      .expect(204);
    await request(h.http)
      .put('/v1/me/settings/language')
      .set(...bearer(s.accessToken))
      .send({ language: 'fr' })
      .expect(400);
    expect(
      (
        await request(h.http)
          .get('/v1/me')
          .set(...bearer(s.accessToken))
      ).body.language,
    ).toBe('te');
    await request(h.http)
      .post('/v1/me/consents')
      .set(...bearer(s.accessToken))
      .send({ kind: 'contacts', granted: true, version: '2026-10' })
      .expect(204);
    const token = `ExponentPushToken[${s.user.id.slice(0, 12)}]`;
    await request(h.http)
      .post('/v1/me/devices')
      .set(...bearer(s.accessToken))
      .send({ expoPushToken: token, platform: 'android' })
      .expect(204);
    await request(h.http)
      .post('/v1/me/devices')
      .set(...bearer(s.accessToken))
      .send({ expoPushToken: token, platform: 'android' })
      .expect(204);
    await request(h.http)
      .delete(`/v1/me/devices/${encodeURIComponent(token)}`)
      .set(...bearer(s.accessToken))
      .expect(204);
    await request(h.http)
      .delete(`/v1/me/devices/${encodeURIComponent(token)}`)
      .set(...bearer(s.accessToken))
      .expect(404);
  });
});

describe('data export and deletion (F-ACC-07, DPDP Act 2023)', () => {
  it('exports every registered section as JSON', async () => {
    const s = await signIn(h);
    await onboard(h, s.accessToken);
    await request(h.http)
      .post('/v1/me/consents')
      .set(...bearer(s.accessToken))
      .send({ kind: 'location', granted: false, version: '2026-10' })
      .expect(204);
    const res = await request(h.http)
      .get('/v1/me/export')
      .set(...bearer(s.accessToken))
      .expect(200);
    expect(Object.keys(res.body)).toEqual(
      expect.arrayContaining([
        'account',
        'profile',
        'settings',
        'consents',
        'sessions',
        'invites',
        'exportedAt',
      ]),
    );
    expect(res.body.profile.profile.displayName).toBe('Test Person');
    expect(res.body.consents[0]).toMatchObject({ kind: 'location', granted: false });
    expect(JSON.stringify(res.body)).not.toContain(s.phone);
  });

  it('deactivates immediately, can be cancelled by signing in, and purges after the grace period', async () => {
    const s = await signIn(h);
    await onboard(h, s.accessToken);
    await request(h.http)
      .post('/v1/me/consents')
      .set(...bearer(s.accessToken))
      .send({ kind: 'terms', granted: true, version: '1' })
      .expect(204);
    await request(h.http)
      .post('/v1/me/deletion')
      .set(...bearer(s.accessToken))
      .send({ confirm: 'nope' })
      .expect(400);
    const del = await request(h.http)
      .post('/v1/me/deletion')
      .set(...bearer(s.accessToken))
      .send({ confirm: 'DELETE' })
      .expect(202);
    expect(new Date(del.body.purgeAfter).getTime() - Date.now()).toBeGreaterThan(13 * 86_400_000);
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(s.accessToken))
      .expect(401);

    const back = await signIn(h, s.phone, { inviteCode: null });
    expect(back.user.status).toBe('active');
    await request(h.http)
      .post('/v1/me/deletion')
      .set(...bearer(back.accessToken))
      .send({ confirm: 'DELETE' })
      .expect(202);

    const photoKeys = (
      await h.pool.query<{ variant_keys: { sm: string } }>(
        'SELECT variant_keys FROM media_assets WHERE owner_user_id = $1',
        [s.user.id],
      )
    ).rows;
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '15 days' WHERE id = $1",
      [s.user.id],
    );
    expect(await h.app.get(AccountService).purgeDue()).toBeGreaterThanOrEqual(1);
    const { rows } = await h.pool.query(
      'SELECT status, phone_e164, phone_hash FROM users WHERE id = $1',
      [s.user.id],
    );
    expect(rows[0]).toEqual({ status: 'deleted', phone_e164: null, phone_hash: null });
    expect(
      (await h.pool.query('SELECT 1 FROM profiles WHERE user_id = $1', [s.user.id])).rows,
    ).toHaveLength(0);
    expect(
      (await h.pool.query('SELECT kind FROM consents WHERE user_id = $1', [s.user.id])).rows,
    ).toEqual([{ kind: 'terms' }]);
    expect(await h.storage.head(photoKeys[0]?.variant_keys.sm ?? 'missing')).toBeNull();

    const fresh = await signIn(h, s.phone);
    expect(fresh.isNewUser).toBe(true);
  });
});
