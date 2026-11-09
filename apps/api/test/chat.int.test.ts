import type { INestApplication } from '@nestjs/common';
import type { ConversationSummary, Message, MessagePage, PollView } from '@touchgrass/shared';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePushSender } from '../src/adapters/push/fake.push.js';
import { AtEventService } from '../src/modules/at-event/at-event.service.js';
import { ChatPresence } from '../src/modules/chat/chat-presence.js';
import { ChatHandlers } from '../src/modules/chat/chat.handlers.js';
import { createRealtimeApp } from '../src/realtime/bootstrap-realtime.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { idem, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  bearer,
  befriend,
  createHarness,
  type Harness,
  member,
  type Member,
  testJpeg,
} from './harness.js';
import { integrationEnv } from './helpers.js';

let h: Harness;
let rt: INestApplication;
let rtPort: number;
const push = new FakePushSender();
const sockets: Socket[] = [];

beforeAll(async () => {
  h = await createHarness({ push });
  rt = await createRealtimeApp(integrationEnv(), { logger: false });
  await rt.listen(0, '127.0.0.1');
  rtPort = ((rt.getHttpServer() as HttpServer).address() as AddressInfo).port;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await rt.close();
  await h.close();
});

const H = 3_600_000;
let clientSeq = 0;
const cid = (): string => `c${String(Date.now())}${String((clientSeq += 1))}x`;

async function socket(m: Member, ns = '/chat'): Promise<Socket> {
  const s = io(`http://127.0.0.1:${String(rtPort)}${ns}`, {
    auth: { token: m.token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => {
      resolve();
    });
    s.once('connect_error', reject);
  });
  // Room joins happen in the connection handler; give it a beat before anything is emitted.
  await new Promise((r) => setTimeout(r, 100));
  return s;
}
function next<T>(s: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    s.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}
const startDm = (from: Member, to: Member) =>
  request(h.http)
    .post('/v1/chats/direct')
    .set(...bearer(from.token))
    .send({ userId: to.id });
const send = (m: Member, conversationId: string, body: Record<string, unknown>) =>
  request(h.http)
    .post(`/v1/chats/${conversationId}/messages`)
    .set(...bearer(m.token))
    .send({ clientId: cid(), ...body });
const page = async (m: Member, conversationId: string): Promise<MessagePage> =>
  (
    await request(h.http)
      .get(`/v1/chats/${conversationId}/messages`)
      .set(...bearer(m.token))
      .expect(200)
  ).body as MessagePage;
const inbox = async (
  m: Member,
  filter: 'all' | 'requests' = 'all',
): Promise<ConversationSummary[]> =>
  (
    (
      await request(h.http)
        .get('/v1/chats')
        .query({ filter })
        .set(...bearer(m.token))
        .expect(200)
    ).body as { items: ConversationSummary[] }
  ).items;

/** Runs the worker's chat handlers over the outbox rows for one conversation. */
async function drain(conversationId: string): Promise<void> {
  const bus = new DomainEventBus();
  h.app.get(ChatHandlers).registerOn(bus);
  const { rows } = await h.pool.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    "SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type LIKE 'chat.%' ORDER BY created_at",
    [conversationId],
  );
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
async function device(m: Member, token: string): Promise<void> {
  await request(h.http)
    .post('/v1/me/devices')
    .set(...bearer(m.token))
    .send({ expoPushToken: token, platform: 'android' })
    .expect(204);
}

describe('direct messages (F-CHT-01/04)', () => {
  it('squad chat directly; messages arrive live, unread counts, read receipts both ways', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    expect(conv).toMatchObject({
      kind: 'direct',
      state: 'active',
      title: 'Test Person',
      unreadCount: 0,
    });
    expect((await startDm(b, a).expect(201)).body.id).toBe(conv.id);
    const bSock = await socket(b);
    const arrived = next<Message>(bSock, 'message:new');
    const sent = (await send(a, conv.id, { body: 'Pulling up tonight?' }).expect(201))
      .body as Message;
    expect(sent).toMatchObject({ mine: true, kind: 'text', body: 'Pulling up tonight?' });
    expect(await arrived).toMatchObject({ id: sent.id, mine: false, body: 'Pulling up tonight?' });
    expect((await inbox(b)).find((c) => c.id === conv.id)).toMatchObject({
      unreadCount: 1,
      lastMessage: { excerpt: 'Pulling up tonight?' },
    });

    const aSock = await socket(a);
    const receipt = next<{ messageId: string }>(aSock, 'conversation:read');
    await request(h.http)
      .post(`/v1/chats/${conv.id}/read`)
      .set(...bearer(b.token))
      .send({ messageId: sent.id })
      .expect(204);
    expect((await receipt).messageId).toBe(sent.id);
    expect((await inbox(b)).find((c) => c.id === conv.id)?.unreadCount).toBe(0);
    expect((await page(a, conv.id)).readBy).toEqual([{ userId: b.id, messageId: sent.id }]);

    // Turning receipts off hides them both ways.
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(b.token))
      .send({ readReceipts: false })
      .expect(200);
    expect((await page(a, conv.id)).readBy).toEqual([]);
    expect((await page(b, conv.id)).readBy).toEqual([]);
  });

  it('strangers start with a message request: one message, then wait; accept or silently decline', async () => {
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    expect(conv.state).toBe('request_sent');
    await send(a, conv.id, { body: 'Hi! Loved your photo walk idea' }).expect(201);
    expect((await send(a, conv.id, { body: 'Are you there?' }).expect(409)).body.error.code).toBe(
      'MESSAGE_REQUEST_PENDING',
    );
    expect((await inbox(b)).map((x) => x.id)).not.toContain(conv.id);
    expect((await inbox(b, 'requests')).find((x) => x.id === conv.id)).toMatchObject({
      state: 'request_received',
      readOnly: true,
    });
    expect((await send(b, conv.id, { body: 'hey' }).expect(409)).body.error.code).toBe(
      'MESSAGE_REQUEST_PENDING',
    );
    const accepted = await request(h.http)
      .post(`/v1/chats/${conv.id}/request`)
      .set(...bearer(b.token))
      .send({ accept: true })
      .expect(200);
    expect(accepted.body.state).toBe('active');
    await send(b, conv.id, { body: 'hey!' }).expect(201);
    await send(a, conv.id, { body: 'yay' }).expect(201);
    expect((await page(a, conv.id)).items.map((m) => m.system?.type ?? m.body)).toEqual([
      'yay',
      'hey!',
      'request_accepted',
      'Hi! Loved your photo walk idea',
    ]);

    const other = (await startDm(c, b).expect(201)).body as ConversationSummary;
    await send(c, other.id, { body: 'hello' }).expect(201);
    await request(h.http)
      .post(`/v1/chats/${other.id}/request`)
      .set(...bearer(b.token))
      .send({ accept: false })
      .expect(204);
    expect((await inbox(b, 'requests')).map((x) => x.id)).not.toContain(other.id);
    await request(h.http)
      .get(`/v1/chats/${other.id}`)
      .set(...bearer(b.token))
      .expect(404);
    expect(
      (
        await request(h.http)
          .get(`/v1/chats/${other.id}`)
          .set(...bearer(c.token))
          .expect(200)
      ).body.state,
    ).toBe('request_sent');
  });

  it('people who shared a plan in the last 30 days chat directly', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    await rsvp(h, b, e.id).expect(200);
    expect((await startDm(a, b).expect(201)).body.state).toBe('active');
  });

  it('blocks make chats disappear both ways', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    await send(a, conv.id, { body: 'hi' }).expect(201);
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(b.token))
      .set(...idem())
      .send({ userId: a.id })
      .expect(204);
    await request(h.http)
      .get(`/v1/chats/${conv.id}`)
      .set(...bearer(a.token))
      .expect(404);
    await request(h.http)
      .get(`/v1/chats/${conv.id}/messages`)
      .set(...bearer(b.token))
      .expect(404);
    await send(a, conv.id, { body: 'hello?' }).expect(404);
    await startDm(a, b).expect(404);
    expect((await inbox(b)).map((x) => x.id)).not.toContain(conv.id);
    await startDm(a, a).expect(400);
  });
});

describe('messaging features (F-CHT-04)', () => {
  it('offline-queue retries never duplicate, even concurrently', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    const clientId = cid();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(h.http)
          .post(`/v1/chats/${conv.id}/messages`)
          .set(...bearer(a.token))
          .send({ clientId, body: 'once' }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => (r.body as Message).id)).size).toBe(1);
    expect((await page(b, conv.id)).items.filter((m) => m.body === 'once')).toHaveLength(1);
  });

  it('replies, images, reactions, delete for me and for everyone', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    const first = (await send(a, conv.id, { body: 'Who is bringing snacks?' }).expect(201))
      .body as Message;
    const reply = (await send(b, conv.id, { body: 'Me!', replyToId: first.id }).expect(201))
      .body as Message;
    expect(reply.replyTo).toMatchObject({
      id: first.id,
      senderName: 'Test Person',
      excerpt: 'Who is bringing snacks?',
    });
    await send(b, conv.id, { body: 'x', replyToId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' }).expect(
      400,
    );

    const jpeg = await testJpeg(800, 600);
    const up = await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(a.token))
      .send({ purpose: 'chat', contentType: 'image/jpeg', sizeBytes: jpeg.length })
      .expect(201);
    await send(a, conv.id, { kind: 'image', mediaId: up.body.assetId }).expect(409);
    h.storage.simulateUpload(up.body.upload.fields.key as string, jpeg, 'image/jpeg');
    await request(h.http)
      .post(`/v1/media/${String(up.body.assetId)}/complete`)
      .set(...bearer(a.token))
      .expect(200);
    const { MediaProcessor } = await import('../src/modules/media/media.processor.js');
    await h.app.get(MediaProcessor).process(up.body.assetId as string);
    const image = (await send(a, conv.id, { kind: 'image', mediaId: up.body.assetId }).expect(201))
      .body as Message;
    expect(image.image?.md).toMatch(/^http/);

    const reacted = await request(h.http)
      .post(`/v1/chats/${conv.id}/messages/${first.id}/reactions`)
      .set(...bearer(b.token))
      .send({ emoji: '🙌' })
      .expect(200);
    expect(reacted.body.reactions).toEqual([{ emoji: '🙌', count: 1, mine: true }]);
    await request(h.http)
      .post(`/v1/chats/${conv.id}/messages/${first.id}/reactions`)
      .set(...bearer(b.token))
      .send({ emoji: '🙌' })
      .expect(200);
    const aView = await request(h.http)
      .get(`/v1/chats/${conv.id}/messages/${first.id}`)
      .set(...bearer(a.token))
      .expect(200);
    expect(aView.body.reactions).toEqual([{ emoji: '🙌', count: 1, mine: false }]);
    const un = await request(h.http)
      .delete(`/v1/chats/${conv.id}/messages/${first.id}/reactions`)
      .query({ emoji: '🙌' })
      .set(...bearer(b.token))
      .expect(200);
    expect(un.body.reactions).toEqual([]);
    await request(h.http)
      .post(`/v1/chats/${conv.id}/messages/${first.id}/reactions`)
      .set(...bearer(b.token))
      .send({ emoji: '🍕' })
      .expect(400);

    await request(h.http)
      .delete(`/v1/chats/${conv.id}/messages/${reply.id}`)
      .query({ scope: 'me' })
      .set(...bearer(a.token))
      .expect(204);
    expect((await page(a, conv.id)).items.map((m) => m.id)).not.toContain(reply.id);
    expect((await page(b, conv.id)).items.map((m) => m.id)).toContain(reply.id);
    await request(h.http)
      .delete(`/v1/chats/${conv.id}/messages/${first.id}`)
      .query({ scope: 'everyone' })
      .set(...bearer(b.token))
      .expect(403);
    await request(h.http)
      .delete(`/v1/chats/${conv.id}/messages/${first.id}`)
      .query({ scope: 'everyone' })
      .set(...bearer(a.token))
      .expect(204);
    const gone = (await page(b, conv.id)).items.find((m) => m.id === first.id);
    expect(gone).toMatchObject({ deleted: true, body: null });
    const replyNow = (await page(b, conv.id)).items.find((m) => m.id === reply.id);
    expect(replyNow?.replyTo?.excerpt).toBeNull();

    const old = (await send(a, conv.id, { body: 'old' }).expect(201)).body as Message;
    const { ChatService } = await import('../src/modules/chat/chat.service.js');
    await expect(
      h.app
        .get(ChatService)
        .deleteMessage(a.id, conv.id, old.id, 'everyone', new Date(Date.now() + 2 * H)),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'TOO_LATE' } });
  });

  it('push goes to recipients who are not muted and not looking at the chat', async () => {
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    await befriend(h, a, b);
    await befriend(h, a, c);
    const ab = (await startDm(a, b).expect(201)).body as ConversationSummary;
    const ac = (await startDm(a, c).expect(201)).body as ConversationSummary;
    await device(b, `ExponentPushToken[b${b.id.slice(0, 8)}]`);
    await device(c, `ExponentPushToken[c${c.id.slice(0, 8)}]`);
    const before = push.sent.length;
    await send(a, ab.id, { body: 'ping one' }).expect(201);
    await drain(ab.id);
    const mine = push.sent.slice(before).filter((p) => p.to.includes(b.id.slice(0, 8)));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      title: 'Test Person',
      body: 'ping one',
      data: { url: `touchgrass://chats/${ab.id}` },
    });

    await request(h.http)
      .put(`/v1/chats/${ac.id}/mute`)
      .set(...bearer(c.token))
      .send({ duration: 'day' })
      .expect(200);
    const mark = push.sent.length;
    await send(a, ac.id, { body: 'muted?' }).expect(201);
    await drain(ac.id);
    expect(push.sent.slice(mark).filter((p) => p.to.includes(c.id.slice(0, 8)))).toHaveLength(0);

    await h.app.get(ChatPresence).enter(ab.id, b.id);
    const mark2 = push.sent.length;
    await send(a, ab.id, { body: 'looking already' }).expect(201);
    await drain(ab.id);
    expect(
      push.sent
        .slice(mark2)
        .filter((p) => p.to.includes(b.id.slice(0, 8)) && p.body === 'looking already'),
    ).toHaveLength(0);
    expect(
      (
        await request(h.http)
          .get(`/v1/chats/${ac.id}`)
          .set(...bearer(c.token))
          .expect(200)
      ).body.muted,
    ).toBe(true);
  });

  it('inbox pages by latest activity', async () => {
    const me = await member(h);
    const friends = [await member(h), await member(h), await member(h)];
    for (const f of friends) {
      await befriend(h, me, f);
      const c = (await startDm(me, f).expect(201)).body as ConversationSummary;
      await send(f, c.id, { body: `hi from ${f.id}` }).expect(201);
    }
    const p1 = await request(h.http)
      .get('/v1/chats')
      .query({ limit: 2 })
      .set(...bearer(me.token))
      .expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.items[0].peer.id).toBe(friends[2]?.id);
    const p2 = await request(h.http)
      .get('/v1/chats')
      .query({ limit: 2, cursor: p1.body.nextCursor })
      .set(...bearer(me.token))
      .expect(200);
    expect(p2.body.items.map((x: ConversationSummary) => x.peer?.id)).toEqual([friends[0]?.id]);
  });

  it('messages can be reported by people in the chat', async () => {
    const [a, b, outsider] = [await member(h), await member(h), await member(h)];
    await befriend(h, a, b);
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    const msg = (await send(a, conv.id, { body: 'rude thing' }).expect(201)).body as Message;
    const report = (m: Member) =>
      request(h.http)
        .post('/v1/reports')
        .set(...bearer(m.token))
        .set(...idem())
        .send({ targetType: 'message', targetId: msg.id, category: 'harassment' });
    await report(b).expect(201);
    await report(outsider).expect(404);
  });
});

describe('event group chat (F-CHT-02) and polls (F-CHT-05)', () => {
  it('opens 24 h before for people going; outsiders and leavers are out; read-only after', async () => {
    const host = await verifiedMember(h);
    const [a, b, outsider] = [await member(h), await member(h), await member(h)];
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    await rsvp(h, b, e.id).expect(200);
    const early = (
      await request(h.http)
        .get(`/v1/events/${e.id}/chat`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as ConversationSummary;
    expect(early).toMatchObject({
      kind: 'event',
      readOnly: true,
      title: 'Sunset frisbee',
      eventId: e.id,
    });
    expect(early.opensAt).not.toBeNull();
    expect((await send(a, early.id, { body: 'too early' }).expect(409)).body.error.details).toEqual(
      { reason: 'NOT_OPEN' },
    );
    await request(h.http)
      .get(`/v1/events/${e.id}/chat`)
      .set(...bearer(outsider.token))
      .expect(404);
    await request(h.http)
      .get(`/v1/chats/${early.id}/messages`)
      .set(...bearer(outsider.token))
      .expect(404);

    await shiftEvent(h, e.id, 5 * H);
    const bSock = await socket(b);
    const live = next<Message>(bSock, 'message:new');
    const m = (await send(a, early.id, { body: 'See you all there!' }).expect(201)).body as Message;
    expect((await live).id).toBe(m.id);

    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(b.token))
      .expect(204);
    await request(h.http)
      .get(`/v1/chats/${early.id}/messages`)
      .set(...bearer(b.token))
      .expect(404);

    await shiftEvent(h, e.id, -60 * H, H);
    const after = (
      await request(h.http)
        .get(`/v1/chats/${early.id}`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as ConversationSummary;
    expect(after.readOnly).toBe(true);
    expect((await send(a, early.id, { body: 'late' }).expect(409)).body.error.details).toEqual({
      reason: 'CHAT_CLOSED',
    });
    expect((await page(a, early.id)).items[0]?.body).toBe('See you all there!');
  });

  it('hosts run polls; votes are single or multiple choice, anonymous hides voters, results go live', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    await rsvp(h, b, e.id).expect(200);
    await shiftEvent(h, e.id, 3 * H);
    const conv = (
      await request(h.http)
        .get(`/v1/events/${e.id}/chat`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as ConversationSummary;
    const create = (m: Member, body: Record<string, unknown>) =>
      request(h.http)
        .post(`/v1/chats/${conv.id}/polls`)
        .set(...bearer(m.token))
        .send(body);
    await create(a, { question: 'Pizza or biryani?', options: ['Pizza', 'Biryani'] }).expect(403);
    await create(host, { question: 'Pizza or biryani?', options: ['Pizza', 'pizza'] }).expect(400);
    // Poll wording goes to everyone, so flagged words are refused (D-163).
    await create(host, { question: 'Who is the lanja here?', options: ['Me', 'You'] }).expect(400);
    const msg = (
      await create(host, { question: 'Pizza or biryani?', options: ['Pizza', 'Biryani'] }).expect(
        201,
      )
    ).body as Message;
    const poll = msg.poll as PollView;
    const [pizza, biryani] = poll.options.map((o) => o.id);
    const vote = (m: Member, optionIds: (string | undefined)[]) =>
      request(h.http)
        .post(`/v1/polls/${poll.id}/votes`)
        .set(...bearer(m.token))
        .send({ optionIds });
    await vote(a, [pizza, biryani]).expect(400);
    const bSock = await socket(b);
    const update = next<PollView>(bSock, 'poll:updated');
    const mine = (await vote(a, [biryani]).expect(200)).body as PollView;
    expect(mine.options.find((o) => o.id === biryani)).toMatchObject({
      votes: 1,
      mine: true,
      voters: [expect.objectContaining({ id: a.id }) as object],
    });
    expect((await update).totalVoters).toBe(1);
    // Changing your mind replaces the vote; concurrent re-votes settle on one choice.
    await Promise.all([vote(a, [pizza]), vote(a, [pizza]), vote(a, [pizza])]);
    const after = (await vote(b, [pizza]).expect(200)).body as PollView;
    expect(after).toMatchObject({ totalVoters: 2 });
    expect(after.options.map((o) => o.votes)).toEqual([2, 0]);
    await request(h.http)
      .post(`/v1/polls/${poll.id}/close`)
      .set(...bearer(a.token))
      .expect(403);
    expect(
      (
        await request(h.http)
          .post(`/v1/polls/${poll.id}/close`)
          .set(...bearer(host.token))
          .expect(200)
      ).body.closed,
    ).toBe(true);
    expect((await vote(b, [biryani]).expect(409)).body.error.details).toEqual({
      reason: 'POLL_CLOSED',
    });

    const anon = (
      await create(host, {
        question: 'Rate tonight',
        options: ['🔥', '👍'],
        anonymous: true,
        multi: true,
        closesAt: new Date(Date.now() + H).toISOString(),
      }).expect(201)
    ).body as Message;
    const anonView = (
      await request(h.http)
        .post(`/v1/polls/${anon.poll?.id ?? ''}/votes`)
        .set(...bearer(a.token))
        .send({ optionIds: anon.poll?.options.map((o) => o.id) })
        .expect(200)
    ).body as PollView;
    expect(anonView.options.every((o) => o.votes === 1 && o.voters.length === 0)).toBe(true);
  });
});

describe('at the event (F-ATE-01..03)', () => {
  it('icebreaker deck, host push to every screen and the chat, chats opening with an icebreaker', async () => {
    const host = await verifiedMember(h);
    const [a, outsider] = [await member(h), await member(h)];
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    const deck = (
      await request(h.http)
        .get(`/v1/events/${e.id}/icebreakers`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as { items: { id: string; prompt: { te: string } }[] };
    expect(deck.items.length).toBeGreaterThanOrEqual(10);
    expect(deck.items[0]?.prompt.te).toMatch(/[ఀ-౿]/);
    await request(h.http)
      .get(`/v1/events/${e.id}/icebreakers`)
      .set(...bearer(outsider.token))
      .expect(404);

    await shiftEvent(h, e.id, 2 * H);
    expect(await h.app.get(AtEventService).openEventChats()).toBeGreaterThanOrEqual(1);
    const chat = (
      await request(h.http)
        .get(`/v1/events/${e.id}/chat`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as ConversationSummary;
    const opened = (await page(a, chat.id)).items.find((m) => m.system?.type === 'chat_opened');
    expect(opened?.system).toMatchObject({
      type: 'chat_opened',
      prompt: { en: expect.any(String) as string },
    });
    expect(await h.app.get(AtEventService).openEventChats()).toBe(0);

    const evSock = await socket(a, '/events');
    expect(await evSock.emitWithAck('event:join', { eventId: e.id })).toEqual({
      ok: true,
      data: { joined: true },
    });
    const outsiderSock = await socket(outsider, '/events');
    expect((await outsiderSock.emitWithAck('event:join', { eventId: e.id })).ok).toBe(false);
    const shown = next<{ card: { id: string } }>(evSock, 'icebreaker:show');
    const card = deck.items[1]?.id ?? '';
    await request(h.http)
      .post(`/v1/events/${e.id}/icebreakers/push`)
      .set(...bearer(a.token))
      .send({ cardId: card })
      .expect(403);
    await request(h.http)
      .post(`/v1/events/${e.id}/icebreakers/push`)
      .set(...bearer(host.token))
      .send({ cardId: card })
      .expect(200);
    expect((await shown).card.id).toBe(card);
    expect((await page(a, chat.id)).items[0]?.system?.type).toBe('icebreaker');
  });

  it('find-your-group: from 30 minutes before, different for overlapping plans nearby', async () => {
    const [h1, h2] = [await verifiedMember(h), await verifiedMember(h)];
    const a = await member(h);
    const e1 = await plot(h, h1);
    const e2 = await plot(h, h2);
    await rsvp(h, a, e1.id).expect(200);
    const early = await request(h.http)
      .get(`/v1/events/${e1.id}/signal`)
      .set(...bearer(a.token))
      .expect(409);
    expect(early.body.error.details).toMatchObject({ reason: 'SIGNAL_NOT_YET' });
    await shiftEvent(h, e1.id, 20 * 60_000);
    await shiftEvent(h, e2.id, 20 * 60_000);
    const [s1, s1again, s2] = await Promise.all([
      request(h.http)
        .get(`/v1/events/${e1.id}/signal`)
        .set(...bearer(a.token))
        .expect(200),
      request(h.http)
        .get(`/v1/events/${e1.id}/signal`)
        .set(...bearer(h1.token))
        .expect(200),
      request(h.http)
        .get(`/v1/events/${e2.id}/signal`)
        .set(...bearer(h2.token))
        .expect(200),
    ]);
    expect(s1.body).toEqual(s1again.body);
    expect(s1.body).toMatchObject({
      color: expect.stringMatching(/^#[0-9A-F]{6}$/) as string,
      colorName: expect.any(String) as string,
      iconName: expect.any(String) as string,
    });
    expect(`${String(s1.body.color)}${String(s1.body.icon)}`).not.toBe(
      `${String(s2.body.color)}${String(s2.body.icon)}`,
    );
    await request(h.http)
      .get(`/v1/events/${e2.id}/signal`)
      .set(...bearer(a.token))
      .expect(404);
  });

  it('welcome hosts see first-timers and tick them off', async () => {
    const host = await verifiedMember(h);
    const [newbie, regular] = [await member(h), await member(h)];
    const old = await plot(h, await verifiedMember(h));
    await rsvp(h, regular, old.id).expect(200);
    await h.pool.query(
      "UPDATE rsvps SET status = 'checked_in', checked_in_at = now() WHERE event_id = $1 AND user_id = $2",
      [old.id, regular.id],
    );
    const e = await plot(h, host);
    await rsvp(h, newbie, e.id).expect(200);
    await rsvp(h, regular, e.id).expect(200);
    const list = await request(h.http)
      .get(`/v1/events/${e.id}/newcomers`)
      .set(...bearer(host.token))
      .expect(200);
    expect(list.body.items.map((i: { person: { id: string } }) => i.person.id)).toEqual([
      newbie.id,
    ]);
    await request(h.http)
      .get(`/v1/events/${e.id}/newcomers`)
      .set(...bearer(regular.token))
      .expect(403);
    const ticked = await request(h.http)
      .put(`/v1/events/${e.id}/newcomers/${newbie.id}`)
      .set(...bearer(host.token))
      .send({ welcomed: true })
      .expect(200);
    expect(ticked.body.items[0]).toMatchObject({
      welcomed: true,
      welcomedBy: 'Test Person',
      checkedIn: false,
    });
    await request(h.http)
      .put(`/v1/events/${e.id}/newcomers/${regular.id}`)
      .set(...bearer(host.token))
      .send({ welcomed: true })
      .expect(404);
  });
});

describe('typing indicators and the realtime HTTP surface', () => {
  it('typing reaches the other person only after joining; the realtime port serves health only', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    const conv = (await startDm(a, b).expect(201)).body as ConversationSummary;
    const [aSock, bSock] = [await socket(a), await socket(b)];
    expect(
      await aSock.emitWithAck('chat:join', {
        conversationId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
      }),
    ).toMatchObject({ ok: false });
    expect(await aSock.emitWithAck('chat:join', { conversationId: conv.id })).toEqual({
      ok: true,
      data: { joined: true },
    });
    const typing = next<{ userId: string; typing: boolean }>(bSock, 'typing');
    aSock.emit('chat:typing', { conversationId: conv.id, typing: true });
    expect(await typing).toMatchObject({ userId: a.id, typing: true });
    expect(await h.app.get(ChatPresence).isPresent(conv.id, a.id)).toBe(true);
    aSock.emit('chat:leave', { conversationId: conv.id });
    await new Promise((r) => setTimeout(r, 150));
    expect(await h.app.get(ChatPresence).isPresent(conv.id, a.id)).toBe(false);

    await request(rt.getHttpServer()).get('/v1/health/live').expect(200);
    await request(rt.getHttpServer())
      .get('/v1/chats')
      .set(...bearer(a.token))
      .expect(404);
  });
});
