import type { ConversationSummary, EventComment, EventCommentPage } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventCommentsHandlers } from '../src/modules/event-comments/event-comments.handlers.js';
import { UsersService } from '../src/modules/users/users.service.js';
import {
  detail,
  idem,
  outboxFor,
  plot,
  rsvp,
  shiftEvent,
  verifiedMember,
} from './event-helpers.js';
import {
  bearer,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
} from './harness.js';

let h: Harness;
let admin: Member;
const H = 3_600_000;

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

const list = (m: Member, eventId: string) =>
  request(h.http)
    .get(`/v1/events/${eventId}/comments`)
    .set(...bearer(m.token));
const post = (m: Member, eventId: string, body: string) =>
  request(h.http)
    .post(`/v1/events/${eventId}/comments`)
    .set(...bearer(m.token))
    .set(...idem())
    .send({ body });
const remove = (m: Member, commentId: string) =>
  request(h.http)
    .delete(`/v1/comments/${commentId}`)
    .set(...bearer(m.token));

describe('comments on plans (D-156)', () => {
  it('anyone who can see the plan reads and posts; hosts are marked and notified', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const e = await plot(h, host, { visibility: 'public' });
    const mine = (await post(a, e.id, '  Is parking available?  ').expect(201))
      .body as EventComment;
    expect(mine).toMatchObject({ body: 'Is parking available?', mine: true, canDelete: true });
    await post(host, e.id, 'Yes, behind the gate.').expect(201);

    const seen = (await list(b, e.id).expect(200)).body as EventCommentPage;
    expect(seen.canComment).toBe(true);
    expect(seen.items.map((c) => [c.body, c.fromHost, c.canDelete])).toEqual([
      ['Yes, behind the gate.', true, false],
      ['Is parking available?', false, false],
    ]);
    const asHost = (await list(host, e.id).expect(200)).body as EventCommentPage;
    expect(asHost.items.every((c) => c.canDelete)).toBe(true);

    // Hosts hear about it; the author's own host comment doesn't notify them.
    expect(await outboxFor(h, e.id, 'event.commented')).toHaveLength(2);
    expect(
      await h.app.get(EventCommentsHandlers).notifyHosts(e.id, mine.id),
    ).toBeGreaterThanOrEqual(0);
    const inbox = (
      await request(h.http)
        .get('/v1/notifications')
        .set(...bearer(host.token))
        .expect(200)
    ).body as { items: { kind: string; title: string }[] };
    expect(inbox.items.find((i) => i.kind === 'event_comment')?.title).toMatch(
      /commented on Sunset frisbee/,
    );

    // When the comment goes, so does the notification quoting it (D-163).
    await remove(a, mine.id).expect(204);
    const after = (
      await request(h.http)
        .get('/v1/notifications')
        .set(...bearer(host.token))
        .expect(200)
    ).body as { items: { kind: string }[] };
    expect(after.items.filter((i) => i.kind === 'event_comment')).toEqual([]);
  });

  it('never leaks: invisible plans 404, blocks hide both ways, held comments stay with the author', async () => {
    const host = await verifiedMember(h);
    const [a, outsider, blocker] = [await member(h), await member(h), await member(h)];
    const hidden = await plot(h, host, { visibility: 'invite_only' });
    await list(outsider, hidden.id).expect(404);
    await post(outsider, hidden.id, 'hello').expect(404);

    const e = await plot(h, host, { visibility: 'public' });
    const said = (await post(a, e.id, 'See you there').expect(201)).body as EventComment;
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(blocker.token))
      .send({ userId: a.id })
      .expect(204);
    expect(((await list(blocker, e.id).expect(200)).body as EventCommentPage).items).toEqual([]);

    const held = (await post(a, e.id, 'you chutiya').expect(201)).body as EventComment;
    expect(held.held).toBe(true);
    const others = (await list(outsider, e.id).expect(200)).body as EventCommentPage;
    expect(others.items.map((c) => c.id)).toEqual([said.id]);
    const own = (await list(a, e.id).expect(200)).body as EventCommentPage;
    expect(own.items.map((c) => [c.id, c.held])).toEqual([
      [held.id, true],
      [said.id, false],
    ]);
    // Held comments don't notify the host.
    expect(await outboxFor(h, e.id, 'event.commented')).toHaveLength(1);

    // A moderator releases it; now everyone sees it.
    const { rows } = await h.pool.query<{ id: string }>(
      `SELECT id FROM moderation_items WHERE target_type = 'event_comment' AND target_id = $1 AND status = 'open'`,
      [held.id],
    );
    await request(h.http)
      .post(`/v1/admin/moderation/items/${rows[0]?.id ?? ''}/resolve`)
      .set(...bearer(admin.token))
      .set(...idem())
      .send({ outcome: 'dismiss' })
      .expect(200);
    expect(((await list(outsider, e.id).expect(200)).body as EventCommentPage).items).toHaveLength(
      2,
    );
  });

  it('authors and hosts delete; others cannot; reports reach moderation; cancelled plans close', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const e = await plot(h, host, { visibility: 'public' });
    const c1 = (await post(a, e.id, 'First').expect(201)).body as EventComment;
    const c2 = (await post(a, e.id, 'Second').expect(201)).body as EventComment;
    await remove(b, c1.id).expect(404);
    await remove(a, c1.id).expect(204);
    await remove(host, c2.id).expect(204);
    expect(((await list(b, e.id).expect(200)).body as EventCommentPage).items).toEqual([]);

    const c3 = (await post(a, e.id, 'Third').expect(201)).body as EventComment;
    await request(h.http)
      .post('/v1/reports')
      .set(...bearer(b.token))
      .set(...idem())
      .send({ targetType: 'event_comment', targetId: c3.id, category: 'harassment' })
      .expect(201);
    await request(h.http)
      .post('/v1/reports')
      .set(...bearer(a.token))
      .set(...idem())
      .send({ targetType: 'event_comment', targetId: c3.id, category: 'harassment' })
      .expect(404);

    await request(h.http)
      .post(`/v1/events/${e.id}/cancel`)
      .set(...bearer(host.token))
      .set(...idem())
      .send({ reason: 'Rain' })
      .expect(200);
    const closed = await post(a, e.id, 'Too late');
    expect(closed.status).toBe(403);
    expect(closed.body.error.details).toMatchObject({ reason: 'COMMENTS_CLOSED' });
  });
});

describe('host switches the group chat off (D-156)', () => {
  it('nobody gets the plan chat while it is off; it comes back when switched on', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host, { visibility: 'public', chatEnabled: false });
    expect(
      ((await detail(h, a, e.id).expect(200)).body as { chatEnabled: boolean }).chatEnabled,
    ).toBe(false);
    await rsvp(h, a, e.id).expect(200);
    await shiftEvent(h, e.id, 5 * H);
    for (const m of [a, host])
      await request(h.http)
        .get(`/v1/events/${e.id}/chat`)
        .set(...bearer(m.token))
        .expect(404);

    await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(host.token))
      .set(...idem())
      .send({ chatEnabled: true })
      .expect(200);
    const chat = (
      await request(h.http)
        .get(`/v1/events/${e.id}/chat`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as ConversationSummary;
    expect(chat.kind).toBe('event');
  });
});
