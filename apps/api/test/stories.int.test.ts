import type {
  ModerationItemDetail,
  PersonStories,
  StoryTray,
  StoryViewersPage,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountService } from '../src/modules/account/account.service.js';
import { MediaProcessor } from '../src/modules/media/media.processor.js';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service.js';
import { StoriesService } from '../src/modules/stories/stories.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { idem } from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
  testJpeg,
} from './harness.js';

let h: Harness;
let admin: Member;

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

/** Upload → complete → process (worker step inline) for a story photo; the original carries EXIF. */
async function storyPhoto(m: Member, purpose = 'story', process = true): Promise<string> {
  const body = await testJpeg(900, 1600, true);
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
  if (process) await h.app.get(MediaProcessor).process(id);
  return id;
}

const postStory = (m: Member, body: Record<string, unknown>) =>
  request(h.http)
    .post('/v1/stories')
    .set(...bearer(m.token))
    .set(...idem())
    .send(body);

async function story(
  m: Member,
  audience: 'squad' | 'squad_fof' = 'squad',
  caption = '',
): Promise<string> {
  const res = await postStory(m, { mediaId: await storyPhoto(m), audience, caption }).expect(201);
  return res.body.id as string;
}

const tray = async (m: Member): Promise<StoryTray> =>
  (
    await request(h.http)
      .get('/v1/stories')
      .set(...bearer(m.token))
      .expect(200)
  ).body as StoryTray;
const trayIds = async (m: Member): Promise<string[]> =>
  (await tray(m)).items.map((i) => i.person.id);
const storiesOf = (viewer: Member, author: Member) =>
  request(h.http)
    .get(`/v1/users/${author.id}/stories`)
    .set(...bearer(viewer.token));
const view = (m: Member, id: string) =>
  request(h.http)
    .post(`/v1/stories/${id}/view`)
    .set(...bearer(m.token));
const like = (m: Member, id: string) =>
  request(h.http)
    .put(`/v1/stories/${id}/like`)
    .set(...bearer(m.token));
const viewers = (m: Member, id: string, query = '') =>
  request(h.http)
    .get(`/v1/stories/${id}/viewers${query}`)
    .set(...bearer(m.token));
const report = (m: Member, id: string) =>
  request(h.http)
    .post('/v1/reports')
    .set(...bearer(m.token))
    .set(...idem())
    .send({ targetType: 'story', targetId: id, category: 'nudity' });
const block = (a: Member, b: Member) =>
  request(h.http)
    .post('/v1/social/blocks')
    .set(...bearer(a.token))
    .send({ userId: b.id })
    .expect(204);

/** author — squad — fof (a friend of the squad member, not of the author) — stranger. */
async function circle(): Promise<{ author: Member; squad: Member; fof: Member; stranger: Member }> {
  const [author, squad, fof, stranger] = [
    await member(h),
    await member(h),
    await member(h),
    await member(h),
  ];
  await befriend(h, author, squad);
  await befriend(h, squad, fof);
  return { author, squad, fof, stranger };
}

describe('posting stories', () => {
  it('needs a ready story photo of your own; strips the original; holds flagged captions', async () => {
    const { author, squad } = await circle();
    // Wrong purpose, someone else's photo, still processing.
    await postStory(author, {
      mediaId: await storyPhoto(author, 'lore'),
      audience: 'squad',
    }).expect(400);
    await postStory(author, { mediaId: await storyPhoto(squad), audience: 'squad' }).expect(404);
    const pending = await storyPhoto(author, 'story', false);
    const notReady = await postStory(author, { mediaId: pending, audience: 'squad' }).expect(409);
    expect(notReady.body.error.code).toBe('MEDIA_NOT_READY');
    // Missing or unknown audience is refused by the schema.
    await postStory(author, { mediaId: await storyPhoto(author) }).expect(400);
    await postStory(author, { mediaId: await storyPhoto(author), audience: 'everyone' }).expect(
      400,
    );

    const id = await story(author, 'squad', '  Sunset at the lake  ');
    const { rows } = await h.pool.query<{ original_key: string; caption: string }>(
      `SELECT m.original_key, s.caption FROM stories s JOIN media_assets m ON m.id = s.media_id WHERE s.id = $1`,
      [id],
    );
    expect(rows[0]?.caption).toBe('Sunset at the lake');
    expect(await h.storage.head(rows[0]?.original_key ?? '')).toBeNull();

    // A flagged caption is saved but held: the author sees it (marked), the squad does not.
    const held = await story(author, 'squad', 'nee lanja');
    const own = (await storiesOf(author, author).expect(200)).body as PersonStories;
    expect(own.items.find((s) => s.id === held)).toMatchObject({ held: true, mine: true });
    const theirs = (await storiesOf(squad, author).expect(200)).body as PersonStories;
    expect(theirs.items.map((s) => s.id)).toEqual([id]);
    await view(squad, held).expect(404);
  });

  it('caps live stories per person and refuses muted people', async () => {
    const m = await member(h);
    await h.pool.query(
      `WITH ma AS (
         INSERT INTO media_assets (owner_user_id, purpose, original_key, content_type, declared_bytes, status)
         SELECT $1, 'story', 'seed/' || gen_random_uuid(), 'image/jpeg', 1, 'ready' FROM generate_series(1, 20)
         RETURNING id
       )
       INSERT INTO stories (author_id, media_id, audience, expires_at)
       SELECT $1, ma.id, 'squad', now() + interval '1 hour' FROM ma`,
      [m.id],
    );
    const full = await postStory(m, { mediaId: await storyPhoto(m), audience: 'squad' }).expect(
      403,
    );
    expect(full.body.error.details).toMatchObject({ reason: 'STORY_LIMIT' });

    const muted = await member(h);
    await h.pool.query(
      `INSERT INTO user_sanctions (user_id, kind, reason, until) VALUES ($1, 'mute', 'test', now() + interval '1 day')`,
      [muted.id],
    );
    const refused = await postStory(muted, {
      mediaId: await storyPhoto(muted),
      audience: 'squad',
    }).expect(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'MUTED' });
  });

  it('needs an idempotency key and respects the kill switch', async () => {
    const m = await member(h);
    await request(h.http)
      .post('/v1/stories')
      .set(...bearer(m.token))
      .send({ mediaId: await storyPhoto(m), audience: 'squad' })
      .expect(400);
    const flags = h.app.get(FeatureFlagsService);
    await flags.set('stories', false);
    try {
      const off = await postStory(m, { mediaId: await storyPhoto(m), audience: 'squad' });
      expect(off.body.error.code).toBe('FEATURE_DISABLED');
      expect((await tray(m)).items).toEqual([]);
    } finally {
      await flags.set('stories', true);
    }
  });
});

describe('who sees a story (privacy)', () => {
  it('squad stories reach the squad only; squad + friends of friends reaches one hop further', async () => {
    const { author, squad, fof, stranger } = await circle();
    const squadOnly = await story(author, 'squad');

    expect(await trayIds(squad)).toEqual([author.id]);
    expect(await trayIds(fof)).not.toContain(author.id);
    expect(await trayIds(stranger)).not.toContain(author.id);
    await storiesOf(fof, author).expect(404);
    await storiesOf(stranger, author).expect(404);
    for (const outsider of [fof, stranger]) {
      await view(outsider, squadOnly).expect(404);
      await like(outsider, squadOnly).expect(404);
      await report(outsider, squadOnly).expect(404);
    }

    const wider = await story(author, 'squad_fof');
    expect(await trayIds(fof)).toEqual([author.id]);
    const fofView = (await storiesOf(fof, author).expect(200)).body as PersonStories;
    expect(fofView.items.map((s) => s.id)).toEqual([wider]);
    // Others never learn who else saw it, how many, or the audience.
    expect(fofView.items[0]).toMatchObject({ audience: null, viewCount: null, likeCount: null });
    expect(await trayIds(stranger)).not.toContain(author.id);
    await storiesOf(stranger, author).expect(404);
  });

  it('a block either way hides everything, both directions', async () => {
    const { author, squad } = await circle();
    const id = await story(author, 'squad_fof');
    await block(squad, author);
    expect(await trayIds(squad)).toEqual([]);
    await storiesOf(squad, author).expect(404);
    await view(squad, id).expect(404);

    const { author: a2, squad: s2 } = await circle();
    const id2 = await story(a2);
    await block(a2, s2);
    expect(await trayIds(s2)).toEqual([]);
    await view(s2, id2).expect(404);
  });

  it('expired, removed and image-rejected stories are gone; suspended authors disappear', async () => {
    const { author, squad } = await circle();
    const expired = await story(author);
    await h.pool.query(
      `UPDATE stories SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE id = $1`,
      [expired],
    );
    await view(squad, expired).expect(404);
    expect(await trayIds(squad)).toEqual([]);
    expect(await trayIds(author)).toEqual([]);

    const live = await story(author);
    expect(await trayIds(squad)).toEqual([author.id]);
    await h.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [author.id]);
    expect(await trayIds(squad)).toEqual([]);
    await view(squad, live).expect(404);
    await h.pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [author.id]);

    await h.pool.query(
      `UPDATE media_assets SET status = 'rejected' WHERE id = (SELECT media_id FROM stories WHERE id = $1)`,
      [live],
    );
    expect(await trayIds(squad)).toEqual([]);
  });

  it('the tray puts you first, then unseen, then seen, and marks what is new', async () => {
    const [me, x, y] = [await member(h), await member(h), await member(h)];
    await befriend(h, me, x);
    await befriend(h, me, y);
    const xs = await story(x);
    await story(y);
    await story(me);
    let t = await tray(me);
    expect(t.items[0]).toMatchObject({ mine: true, unseen: false, count: 1 });
    expect(t.items.slice(1).map((i) => [i.person.id, i.unseen])).toEqual([
      [y.id, true],
      [x.id, true],
    ]);
    await view(me, xs).expect(204);
    t = await tray(me);
    expect(t.items.map((i) => [i.person.id, i.unseen])).toEqual([
      [me.id, false],
      [y.id, true],
      [x.id, false],
    ]);
    const xStories = (await storiesOf(me, x).expect(200)).body as PersonStories;
    expect(xStories.items[0]).toMatchObject({ seen: true, liked: false, mine: false });
  });
});

describe('likes and viewers', () => {
  it('only the author sees who viewed and liked; authors cannot like their own', async () => {
    const { author, squad, fof } = await circle();
    const id = await story(author, 'squad_fof');
    await view(squad, id).expect(204);
    await view(squad, id).expect(204);
    await like(fof, id).expect(204);
    await like(fof, id).expect(204);
    await like(author, id).expect(400);
    await view(author, id).expect(204);

    const own = (await storiesOf(author, author).expect(200)).body as PersonStories;
    expect(own.items[0]).toMatchObject({ viewCount: 2, likeCount: 1, audience: 'squad_fof' });
    const list = (await viewers(author, id).expect(200)).body as StoryViewersPage;
    expect(list.items.map((v) => [v.person.id, v.liked])).toEqual([
      [fof.id, true],
      [squad.id, false],
    ]);
    const page = (await viewers(author, id, '?limit=1').expect(200)).body as StoryViewersPage;
    expect(page.items).toHaveLength(1);
    const next = (
      await viewers(
        author,
        id,
        `?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      ).expect(200)
    ).body as StoryViewersPage;
    expect(next.items.map((v) => v.person.id)).toEqual([squad.id]);
    expect(next.nextCursor).toBeNull();

    await viewers(squad, id).expect(404);
    await viewers(fof, id).expect(404);

    await request(h.http)
      .delete(`/v1/stories/${id}/like`)
      .set(...bearer(fof.token))
      .expect(204);
    const after = (await viewers(author, id).expect(200)).body as StoryViewersPage;
    expect(after.items.find((v) => v.person.id === fof.id)?.liked).toBe(false);

    // A viewer who is blocked later drops out of the author's list.
    await block(author, squad);
    const blocked = (await viewers(author, id).expect(200)).body as StoryViewersPage;
    expect(blocked.items.map((v) => v.person.id)).toEqual([fof.id]);
  });

  it('only the author deletes a story; its views, likes and files go with it', async () => {
    const { author, squad } = await circle();
    const id = await story(author);
    await like(squad, id).expect(204);
    const { rows } = await h.pool.query<{ variant_keys: { sm: string } }>(
      `SELECT m.variant_keys FROM stories s JOIN media_assets m ON m.id = s.media_id WHERE s.id = $1`,
      [id],
    );
    await request(h.http)
      .delete(`/v1/stories/${id}`)
      .set(...bearer(squad.token))
      .expect(404);
    await request(h.http)
      .delete(`/v1/stories/${id}`)
      .set(...bearer(author.token))
      .expect(204);
    expect(
      (await h.pool.query('SELECT 1 FROM story_likes WHERE story_id = $1', [id])).rows,
    ).toHaveLength(0);
    expect(await h.storage.head(rows[0]?.variant_keys.sm ?? 'missing')).toBeNull();
    expect(await trayIds(squad)).toEqual([]);
  });
});

describe('reports, moderation and data', () => {
  const resolve = (itemId: string, body: object) =>
    request(h.http)
      .post(`/v1/admin/moderation/items/${itemId}/resolve`)
      .set(...bearer(admin.token))
      .set(...idem())
      .send(body);
  async function openItem(targetId: string): Promise<string> {
    const { rows } = await h.pool.query<{ id: string }>(
      `SELECT id FROM moderation_items WHERE target_type = 'story' AND target_id = $1 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [targetId],
    );
    if (!rows[0]) throw new Error(`no open item for story ${targetId}`);
    return rows[0].id;
  }

  it('viewers report a story; moderators take it down for everyone', async () => {
    const { author, squad } = await circle();
    const id = await story(author, 'squad', 'Look at this');
    await report(author, id).expect(404);
    await report(squad, id).expect(201);
    const itemId = await openItem(id);
    const detail = (
      await request(h.http)
        .get(`/v1/admin/moderation/items/${itemId}`)
        .set(...bearer(admin.token))
        .expect(200)
    ).body as ModerationItemDetail;
    expect(detail.preview).toMatchObject({ text: 'Look at this', gone: false });
    expect(detail.preview.image?.md).toMatch(/^http/);
    const done = (await resolve(itemId, { outcome: 'remove' }).expect(200))
      .body as ModerationItemDetail;
    expect(done).toMatchObject({ status: 'actioned', preview: { gone: true } });
    await view(squad, id).expect(404);
    expect(await trayIds(author)).toEqual([]);
  });

  it('a held caption shows to the squad once a moderator releases it', async () => {
    const { author, squad } = await circle();
    const id = await story(author, 'squad', 'you chutiya');
    await view(squad, id).expect(404);
    await resolve(await openItem(id), { outcome: 'dismiss' }).expect(200);
    await view(squad, id).expect(204);
  });

  it('the hourly purge deletes long-expired stories with their files', async () => {
    const { author, squad } = await circle();
    const old = await story(author);
    const fresh = await story(author);
    await view(squad, old).expect(204);
    await h.pool.query(
      `UPDATE stories SET created_at = now() - interval '100 hours', expires_at = now() - interval '76 hours' WHERE id = $1`,
      [old],
    );
    const { rows } = await h.pool.query<{ variant_keys: { lg: string } }>(
      `SELECT m.variant_keys FROM stories s JOIN media_assets m ON m.id = s.media_id WHERE s.id = $1`,
      [old],
    );
    expect(await h.app.get(StoriesService).purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(
      (await h.pool.query('SELECT id FROM stories WHERE id = ANY($1)', [[old, fresh]])).rows,
    ).toEqual([{ id: fresh }]);
    expect(
      (await h.pool.query('SELECT 1 FROM story_views WHERE story_id = $1', [old])).rows,
    ).toHaveLength(0);
    expect(await h.storage.head(rows[0]?.variant_keys.lg ?? 'missing')).toBeNull();
    // Within the grace period an expired story stays (hidden) for reports in flight.
    await h.pool.query(
      `UPDATE stories SET created_at = now() - interval '30 hours', expires_at = now() - interval '6 hours' WHERE id = $1`,
      [fresh],
    );
    await h.app.get(StoriesService).purgeExpired(new Date(Date.now()));
    expect((await h.pool.query('SELECT 1 FROM stories WHERE id = $1', [fresh])).rows).toHaveLength(
      1,
    );
  });

  it('export includes stories, likes and views; account deletion erases them', async () => {
    const { author, squad } = await circle();
    const id = await story(author);
    const theirs = await story(squad);
    await like(author, theirs).expect(204);
    const exported = await h.app.get(StoriesService).exportFor(author.id);
    expect(exported).toMatchObject({
      stories: [{ id, audience: 'squad' }],
      storyLikes: [{ storyId: theirs }],
      storyViews: [{ storyId: theirs }],
    });

    await request(h.http)
      .post('/v1/me/deletion')
      .set(...bearer(author.token))
      .send({ confirm: 'DELETE' })
      .expect(202);
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '15 days' WHERE id = $1",
      [author.id],
    );
    await h.app.get(AccountService).purgeDue();
    expect(
      (await h.pool.query('SELECT 1 FROM stories WHERE author_id = $1', [author.id])).rows,
    ).toHaveLength(0);
    expect(
      (await h.pool.query('SELECT 1 FROM story_likes WHERE user_id = $1', [author.id])).rows,
    ).toHaveLength(0);
    expect(
      (await h.pool.query('SELECT 1 FROM story_views WHERE viewer_id = $1', [author.id])).rows,
    ).toHaveLength(0);
  });
});
