import { CustomerView, InviteNetwork } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service.js';
import { SEED_ADMIN_PHONE } from '../src/seed/seed.js';
import { plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  bearer,
  createHarness,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
} from './harness.js';

let h: Harness;
let admin: string;
let host: Member;
let guest: Member;
let flake: Member;
let pastId: string;
let futureId: string;
const H = 3_600_000;

async function staff(role: 'support' | 'moderator'): Promise<string> {
  const m = await member(h);
  await h.app.get(UsersService).grantRole(m.id, role, null);
  return (await signIn(h, m.phone, { inviteCode: null })).accessToken;
}

const view = (token: string, id: string) =>
  request(h.http)
    .get(`/v1/admin/customers/${id}`)
    .set(...bearer(token));

beforeAll(async () => {
  h = await createHarness();
  admin = (await signIn(h, SEED_ADMIN_PHONE, { inviteCode: null })).accessToken;
  host = await verifiedMember(h);
  guest = await member(h);
  flake = await member(h);
  await h.pool.query('UPDATE users SET invited_by_user_id = $2 WHERE id = $1', [guest.id, host.id]);

  // A finished plan: the guest checked in and rated it; the flake never came.
  const past = await plot(h, host, { title: 'Sunday trek' });
  pastId = past.id;
  await rsvp(h, guest, pastId).expect(200);
  await rsvp(h, flake, pastId).expect(200);
  await h.pool.query(
    `UPDATE rsvps SET status = 'checked_in', checked_in_at = now() - interval '3 hours'
     WHERE event_id = $1 AND user_id = $2`,
    [pastId, guest.id],
  );
  await shiftEvent(h, pastId, -5 * H, 2 * H);
  await h.pool.query(`INSERT INTO event_feedback (event_id, user_id, rating) VALUES ($1, $2, 5)`, [
    pastId,
    guest.id,
  ]);
  // An upcoming plan the guest pulled up to.
  futureId = (await plot(h, host, { title: 'Board games' })).id;
  await rsvp(h, guest, futureId).expect(200);
  // One SOS: only when, never where.
  await h.pool.query(
    `INSERT INTO live_location_shares (id, user_id, started_at, expires_at, sos_at, contacts_notified)
     VALUES (gen_random_uuid(), $1, now() - interval '1 day', now() - interval '20 hours', now() - interval '1 day', 2)`,
    [guest.id],
  );
});
afterAll(async () => {
  await h.close();
});

describe('Customer 360 (D-192)', () => {
  it('admins see plans, ratings, invites, spend and safety, and the view is audited', async () => {
    const res = await view(admin, guest.id).expect(200);
    const v = CustomerView.parse(res.body);
    expect(v.access).toBe('full');
    expect(v.phone).toBe(guest.phone);
    expect(v.stats).toMatchObject({ pulledUp: 2, checkedIn: 1, upcoming: 1, noShows: 0 });
    expect(v.plans.map((p) => p.title)).toEqual(['Board games', 'Sunday trek']);
    expect(v.plans.find((p) => p.eventId === pastId)).toMatchObject({
      role: 'guest',
      rsvp: 'checked_in',
      ratingGiven: 5,
    });
    expect(v.ratingsGiven).toEqual({ count: 1, average: 5 });
    expect(v.invitedBy?.id).toBe(host.id);
    expect(v.spend).toMatchObject({ paidPaise: 0, payments: 0 });
    expect(v.safety).toMatchObject({ sosCount: 1, reportsAgainst: 0, reportsMade: 0 });
    expect(v.timeline.map((t) => t.kind)).toEqual(
      expect.arrayContaining(['joined', 'invited_by', 'pulled_up', 'checked_in', 'sos']),
    );
    // Nothing about where they were.
    expect(JSON.stringify(res.body)).not.toMatch(/"lat"|"lng"|address/i);

    const { rows } = await h.pool.query<{ details: { access: string } }>(
      `SELECT details FROM admin_actions WHERE action = 'users.view_360' AND target_id = $1`,
      [guest.id],
    );
    expect(rows.map((r) => r.details.access)).toContain('full');
  });

  it('counts no-shows and hosted plans', async () => {
    const flakeView = CustomerView.parse((await view(admin, flake.id).expect(200)).body);
    expect(flakeView.stats).toMatchObject({ noShows: 1, checkedIn: 0 });
    const hostView = CustomerView.parse((await view(admin, host.id).expect(200)).body);
    expect(hostView.stats.hosted).toBe(2);
    expect(hostView.invitees).toEqual([]);
    expect(hostView.plans.every((p) => p.role === 'host')).toBe(true);
  });

  it('support sees the lighter view: no phone, money or safety', async () => {
    const v = CustomerView.parse((await view(await staff('support'), guest.id).expect(200)).body);
    expect(v.access).toBe('support');
    expect(v.phone).toBeNull();
    expect(v.spend).toBeNull();
    expect(v.safety).toBeNull();
    expect(v.plans.every((p) => p.paidPaise === null)).toBe(true);
    expect(v.timeline.some((t) => t.kind === 'sos' || t.kind === 'sanction')).toBe(false);
    expect(v.stats.checkedIn).toBe(1);
  });

  it('moderators and members cannot open it; unknown people are 404', async () => {
    await view(await staff('moderator'), guest.id).expect(403);
    await view(flake.token, guest.id).expect(403);
    await view(admin, '0190a4c2-0000-7000-8000-000000000000').expect(404);
  });
});

describe('invite network (D-193)', () => {
  /** A new member let in by `code`, who then makes a code of their own to pass on. */
  async function joinWith(code: string): Promise<{ id: string; code: string }> {
    const s = await signIn(h, undefined, { inviteCode: code });
    await onboard(h, s.accessToken);
    const mine = await request(h.http)
      .post('/v1/me/invites')
      .set(...bearer(s.accessToken))
      .set('Idempotency-Key', `inv-${s.user.id}`)
      .expect(201);
    return { id: s.user.id, code: (mine.body as { code: string }).code };
  }

  it('traces our first invitee to the nth generation, with dates and family sizes', async () => {
    const team = `NET-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await h.pool.query(
      `INSERT INTO invite_codes (id, code, source, max_uses, label) VALUES (gen_random_uuid(), $1, 'admin', 5, 'Launch party')`,
      [team],
    );
    const a = await joinWith(team);
    const b = await joinWith(a.code);
    const c = await joinWith(b.code);

    const res = await request(h.http)
      .get(`/v1/admin/network?root=${a.id}`)
      .set(...bearer(admin))
      .expect(200);
    const net = InviteNetwork.parse(res.body);
    const byId = new Map(net.nodes.map((n) => [n.id, n]));
    expect(byId.get(a.id)).toMatchObject({
      generation: 1,
      entry: 'team',
      codeLabel: 'Launch party',
      direct: 1,
      descendants: 2,
      inviterId: null,
    });
    expect(byId.get(b.id)).toMatchObject({ generation: 2, entry: 'member', inviterId: a.id });
    expect(byId.get(c.id)).toMatchObject({ generation: 3, inviterId: b.id, descendants: 0 });
    expect(net.stats).toMatchObject({ people: 3, deepest: 3, team: 1, member: 2 });
    expect(net.stats.topInviters[0]?.id).toBe(a.id);

    // The whole network includes them too; the time slider leaves out anyone who joined later.
    const all = InviteNetwork.parse(
      (
        await request(h.http)
          .get('/v1/admin/network')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(all.nodes.some((n) => n.id === c.id)).toBe(true);
    const before = InviteNetwork.parse(
      (
        await request(h.http)
          .get('/v1/admin/network?until=2020-01-01')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(before.nodes.some((n) => n.id === a.id)).toBe(false);
  });

  it('is for admins only, and checks its filters', async () => {
    await request(h.http)
      .get('/v1/admin/network')
      .set(...bearer(await staff('support')))
      .expect(403);
    await request(h.http)
      .get('/v1/admin/network?until=yesterday')
      .set(...bearer(admin))
      .expect(400);
  });
});
