import type { HostStatus } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idem, planBody, verifiedMember } from './event-helpers.js';
import { bearer, createHarness, type Harness } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness({}, { PAYMENTS_PROVIDER: 'disabled' });
});
afterAll(async () => {
  await h.close();
});

describe('free plans only (D-165, PAYMENTS_PROVIDER=disabled)', () => {
  it('nobody can apply to sell tickets or plot a paid plan; free plans work as usual', async () => {
    const host = await verifiedMember(h);
    const status = (
      await request(h.http)
        .get('/v1/host/status')
        .set(...bearer(host.token))
        .expect(200)
    ).body as HostStatus;
    expect(status).toMatchObject({ canHostFree: true, canHostPaid: false, ticketsEnabled: false });

    const applied = await request(h.http)
      .post('/v1/host/applications')
      .set(...bearer(host.token))
      .set(...idem())
      .send({
        about: 'I run a weekend cycling group in Gachibowli.',
        experience: 'Hosted thirty rides for groups of ten to forty.',
        eventIdeas: 'Sunrise rides ending at a partner cafe.',
      })
      .expect(403);
    expect(applied.body.error.details).toMatchObject({ reason: 'TICKETS_OFF' });

    await request(h.http)
      .post('/v1/events')
      .set(...bearer(host.token))
      .set(...idem())
      .send(await planBody(h, { pricePaise: 50_000 }))
      .expect(403);
    await request(h.http)
      .post('/v1/events')
      .set(...bearer(host.token))
      .set(...idem())
      .send(await planBody(h))
      .expect(201);
  });

  it('refuses every payment webhook', async () => {
    await request(h.http)
      .post('/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'anything')
      .send({ event: 'payment.captured' })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });
});
