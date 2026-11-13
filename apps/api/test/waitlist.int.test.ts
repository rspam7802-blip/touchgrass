import {
  LaunchWaitlistEntry,
  LaunchWaitlistInviteResult,
  paginated,
  WaitlistInsights,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeEmailSender } from '../src/adapters/email/fake.email.js';
import { UpstreamError } from '../src/adapters/http/http-client.js';
import { ReferralCodesService } from '../src/modules/referrals/referral-codes.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { SEED_ADMIN_PHONE } from '../src/seed/seed.js';
import {
  bearer,
  createHarness,
  freshPhone,
  fromIp,
  type Harness,
  member,
  signIn,
} from './harness.js';

let h: Harness;
let admin: string;
const email = new FakeEmailSender();
const Page = paginated(LaunchWaitlistEntry);

const tag = () => Math.random().toString(36).slice(2, 10);

async function staff(role: 'support' | 'city_curator'): Promise<string> {
  const m = await member(h);
  await h.app.get(UsersService).grantRole(m.id, role, null);
  return (await signIn(h, m.phone, { inviteCode: null })).accessToken;
}

async function rows(where: string, params: unknown[]) {
  const { rows: found } = await h.pool.query<{
    id: string;
    name: string;
    phone_e164: string | null;
    email: string | null;
    city: string;
    note: string | null;
    invited_at: Date | null;
    invite_code_id: string | null;
    source: string | null;
    referrer_user_id: string | null;
  }>(`SELECT * FROM launch_waitlist WHERE ${where}`, params);
  return found;
}

const join = (body: Record<string, unknown>, ip = fromIp()) =>
  request(h.http)
    .post('/v1/public/waitlist')
    .set(...ip)
    .send({ consent: true, ...body });

beforeAll(async () => {
  h = await createHarness({ email });
  admin = (await signIn(h, SEED_ADMIN_PHONE, { inviteCode: null })).accessToken;
});
afterAll(async () => {
  await h.close();
});

describe('public launch waitlist (D-169)', () => {
  it('stores a normalised entry and answers the same for a repeat, updating instead of duplicating', async () => {
    const phone = freshPhone();
    const mail = `Wait.${tag()}@Example.com`;
    const first = await join({ name: 'Asha', phone, city: 'Hyderabad', note: 'Treks' }).expect(200);
    expect(first.body).toEqual({ received: true });
    const [row] = await rows('phone_e164 = $1', [phone]);
    expect(row).toMatchObject({ name: 'Asha', city: 'hyderabad', note: 'Treks', email: null });

    // Same phone again, now with an email and a new city: same row, email filled in, note kept.
    const again = await join({ name: 'Asha K', phone, email: mail, city: 'Navi Mumbai' }).expect(
      200,
    );
    expect(again.body).toEqual(first.body);
    const after = await rows('phone_e164 = $1', [phone]);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: row?.id,
      name: 'Asha K',
      email: mail.toLowerCase(),
      city: 'navi-mumbai',
      note: 'Treks',
    });

    // Matching by email alone (any case) also lands on the same row.
    await join({ name: 'Asha', email: mail.toUpperCase() }).expect(200);
    expect(await rows('email = $1', [mail])).toHaveLength(1);
  });

  it('never moves a contact from one entry to another', async () => {
    const phone = freshPhone();
    const mail = `other.${tag()}@example.com`;
    await join({ name: 'Phone person', phone }).expect(200);
    await join({ name: 'Email person', email: mail }).expect(200);
    await join({ name: 'Both', phone, email: mail }).expect(200);
    const [byPhone] = await rows('phone_e164 = $1', [phone]);
    const [byEmail] = await rows('email = $1', [mail]);
    expect(byPhone?.id).not.toBe(byEmail?.id);
    expect(byPhone?.email).toBeNull();
    expect(byEmail?.phone_e164).toBeNull();
  });

  it('refuses entries without a contact, consent, a valid number or a name', async () => {
    for (const body of [
      { name: 'No contact' },
      { name: 'Empty contact', phone: '', email: '' },
      { name: 'No consent', email: `c.${tag()}@example.com`, consent: false },
      { name: 'Foreign', phone: '+14155552671' },
      { name: 'Bad mail', email: 'nope' },
      { name: '', email: `n.${tag()}@example.com` },
      { name: 'Long note', email: `l.${tag()}@example.com`, note: 'x'.repeat(201) },
    ]) {
      const res = await join(body).expect(400);
      expect(res.body.error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    const noConsent = await request(h.http)
      .post('/v1/public/waitlist')
      .set(...fromIp())
      .send({ name: 'Missing consent', email: `m.${tag()}@example.com` })
      .expect(400);
    expect(noConsent.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('limits submissions per address', async () => {
    const ip = fromIp();
    for (let i = 0; i < 10; i += 1)
      await join(
        { name: `Burst ${String(i)}`, email: `b${String(i)}.${tag()}@example.com` },
        ip,
      ).expect(200);
    const limited = await join({ name: 'One more', email: `b.${tag()}@example.com` }, ip).expect(
      429,
    );
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('admin waitlist (F-WEB-03, D-169)', () => {
  it('keeps members, curators and anonymous callers out; support may list and remove but not invite', async () => {
    const m = await member(h);
    const curator = await staff('city_curator');
    for (const token of [m.token, curator]) {
      await request(h.http)
        .get('/v1/admin/waitlist')
        .set(...bearer(token))
        .expect(403);
    }
    await request(h.http).get('/v1/admin/waitlist').expect(401);
    const support = await staff('support');
    await request(h.http)
      .get('/v1/admin/waitlist')
      .set(...bearer(support))
      .expect(200);
    const mail = `support.${tag()}@example.com`;
    await join({ name: 'Support case', email: mail }).expect(200);
    const [entry] = await rows('email = $1', [mail]);
    await request(h.http)
      .post(`/v1/admin/waitlist/${entry?.id ?? ''}/invite`)
      .set(...bearer(support))
      .expect(403);
    await request(h.http)
      .delete(`/v1/admin/waitlist/${entry?.id ?? ''}`)
      .set(...bearer(support))
      .expect(204);
    expect(await rows('email = $1', [mail])).toHaveLength(0);
  });

  it('lists newest first with cursors, invites with a single-use code, emails it and audits', async () => {
    const mails = [0, 1, 2].map((i) => `list${String(i)}.${tag()}@example.com`);
    for (const [i, mail] of mails.entries())
      await join({ name: `Lister ${String(i)}`, email: mail, language: 'te' }).expect(200);

    const first = Page.parse(
      (
        await request(h.http)
          .get('/v1/admin/waitlist?limit=2&status=all')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(first.items.map((e) => e.email)).toEqual([mails[2], mails[1]]);
    expect(first.nextCursor).toBeTruthy();
    const second = Page.parse(
      (
        await request(h.http)
          .get(
            `/v1/admin/waitlist?limit=2&status=all&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
          )
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(second.items[0]?.email).toBe(mails[0]);

    const target = first.items[0];
    const sentBefore = email.sent.length;
    const invited = LaunchWaitlistInviteResult.parse(
      (
        await request(h.http)
          .post(`/v1/admin/waitlist/${target?.id ?? ''}/invite`)
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(invited.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(invited.emailed).toBe(true);
    expect(invited.entry.inviteCode).toBe(invited.code);
    expect(invited.entry.invitedAt).toBeTruthy();
    const sent = email.sent.slice(sentBefore);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(mails[2]);
    expect(sent[0]?.text).toContain(invited.code);
    expect(sent[0]?.subject).toMatch(/[ఀ-౿]/);

    // The code is a real, single-use, labelled admin code.
    const { rows: codes } = await h.pool.query<{
      max_uses: number;
      label: string;
      source: string;
      expires_at: Date;
    }>('SELECT max_uses, label, source, expires_at FROM invite_codes WHERE code = $1', [
      invited.code,
    ]);
    expect(codes[0]).toMatchObject({ max_uses: 1, label: 'waitlist', source: 'admin' });
    expect(codes[0]?.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const check = await request(h.http)
      .post('/v1/auth/invites/check')
      .set(...fromIp())
      .send({ code: invited.code })
      .expect(200);
    expect(check.body).toEqual({ valid: true, inviterName: null });

    // Invited once only; the waiting filter now leaves the entry out, "all" still shows the code.
    const twice = await request(h.http)
      .post(`/v1/admin/waitlist/${target?.id ?? ''}/invite`)
      .set(...bearer(admin))
      .expect(409);
    expect(twice.body.error.details.reason).toBe('ALREADY_INVITED');
    const waiting = Page.parse(
      (
        await request(h.http)
          .get('/v1/admin/waitlist?limit=100')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(waiting.items.some((e) => e.id === target?.id)).toBe(false);
    const all = Page.parse(
      (
        await request(h.http)
          .get('/v1/admin/waitlist?limit=100&status=all')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(all.items.find((e) => e.id === target?.id)?.inviteCode).toBe(invited.code);

    const { rows: audit } = await h.pool.query<{ action: string; details: { code: string } }>(
      "SELECT action, details FROM admin_actions WHERE target_type = 'launch_waitlist' AND target_id = $1",
      [target?.id],
    );
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'waitlist.invite',
        details: expect.objectContaining({ code: invited.code }),
      }),
    ]);
  });

  it('tells the admin why the email did not go out, and still gives them the code', async () => {
    const mail = `refused-${String(Date.now())}@example.com`;
    await join({ name: 'Refused mail', email: mail }).expect(200);
    const [entry] = await rows('email = $1', [mail]);
    const refusal = new UpstreamError('brevo', 401, '{"message":"unrecognised IP address"}');
    const send = vi.spyOn(email, 'send').mockRejectedValueOnce(refusal);
    const invited = await request(h.http)
      .post(`/v1/admin/waitlist/${entry?.id ?? ''}/invite`)
      .set(...bearer(admin))
      .expect(200);
    send.mockRestore();
    expect(invited.body.emailed).toBe(false);
    expect(invited.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(invited.body.emailError).toBe(
      'brevo request failed with status 401: {"message":"unrecognised IP address"}',
    );
  });

  it('invites phone-only entries without email, removes with an audit entry, 404s on unknown ids', async () => {
    const phone = freshPhone();
    await join({ name: 'Phone only', phone }).expect(200);
    const [entry] = await rows('phone_e164 = $1', [phone]);
    const sentBefore = email.sent.length;
    const invited = await request(h.http)
      .post(`/v1/admin/waitlist/${entry?.id ?? ''}/invite`)
      .set(...bearer(admin))
      .expect(200);
    expect(invited.body.emailed).toBe(false);
    expect(email.sent.length).toBe(sentBefore);
    const [after] = await rows('phone_e164 = $1', [phone]);
    expect(after?.invite_code_id).toBeTruthy();

    await request(h.http)
      .delete(`/v1/admin/waitlist/${entry?.id ?? ''}`)
      .set(...bearer(admin))
      .expect(204);
    expect(await rows('phone_e164 = $1', [phone])).toHaveLength(0);
    const { rows: audit } = await h.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM admin_actions WHERE action = 'waitlist.remove' AND target_id = $1",
      [entry?.id],
    );
    expect(audit[0]?.n).toBe(1);

    const unknown = '00000000-0000-4000-8000-000000000000';
    await request(h.http)
      .delete(`/v1/admin/waitlist/${unknown}`)
      .set(...bearer(admin))
      .expect(404);
    await request(h.http)
      .post(`/v1/admin/waitlist/${unknown}/invite`)
      .set(...bearer(admin))
      .expect(404);
  });
});

describe('waitlist insights (D-191)', () => {
  it('records where people came from and who referred them, and counts them', async () => {
    const friend = await member(h);
    const code = await h.app.get(ReferralCodesService).codeFor(friend.id);
    const tag = String(Date.now());
    await join({
      name: 'From Insta',
      email: `insta-${tag}@example.com`,
      source: 'Instagram',
    }).expect(200);
    await join({ name: 'From WA', email: `wa-${tag}@example.com`, source: 'whatsapp' }).expect(200);
    await join({ name: 'From a friend', email: `ref-${tag}@example.com`, ref: code }).expect(200);
    // Junk sources and codes are ignored, never an error.
    await join({
      name: 'Odd',
      email: `odd-${tag}@example.com`,
      source: '<b>x</b>',
      ref: 'NOPE',
    }).expect(200);
    const [insta] = await rows('email = $1', [`insta-${tag}@example.com`]);
    const [viaFriend] = await rows('email = $1', [`ref-${tag}@example.com`]);
    const [odd] = await rows('email = $1', [`odd-${tag}@example.com`]);
    expect(insta?.source).toBe('instagram');
    expect(viaFriend).toMatchObject({ source: 'referral', referrer_user_id: friend.id });
    expect(odd).toMatchObject({ source: null, referrer_user_id: null });

    const list = paginated(LaunchWaitlistEntry).parse(
      (
        await request(h.http)
          .get('/v1/admin/waitlist?status=all&limit=100')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    const shown = list.items.find((e) => e.email === `ref-${tag}@example.com`);
    expect(shown?.referrer?.id).toBe(friend.id);

    const insights = WaitlistInsights.parse(
      (
        await request(h.http)
          .get('/v1/admin/waitlist/insights?days=30')
          .set(...bearer(admin))
          .expect(200)
      ).body,
    );
    expect(insights.daily).toHaveLength(30);
    expect(insights.totals.inPeriod).toBeGreaterThanOrEqual(4);
    const sources = Object.fromEntries(insights.bySource.map((s) => [s.key, s.count]));
    expect(sources.instagram).toBeGreaterThanOrEqual(1);
    expect(sources.whatsapp).toBeGreaterThanOrEqual(1);
    expect(sources.referral).toBeGreaterThanOrEqual(1);
    expect(insights.byReferrer.find((r) => r.id === friend.id)?.count).toBe(1);
    expect(insights.funnel.signedUp).toBe(insights.totals.inPeriod);
    expect(insights.daily.reduce((n, d) => n + d.signedUp, 0)).toBeGreaterThanOrEqual(4);

    await request(h.http)
      .get('/v1/admin/waitlist/insights?days=14')
      .set(...bearer(admin))
      .expect(400);
  });
});
