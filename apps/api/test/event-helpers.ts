import type { EventDetail } from '@touchgrass/shared';
import request from 'supertest';
import { EventStore } from '../src/modules/events/event-store.service.js';
import { bearer, type Harness, interestIds, member, type Member } from './harness.js';

/** Gachibowli, inside the seeded Hyderabad bounds. */
export const SPOT = { lat: 17.4436, lng: 78.3519 };
export const ADDRESS = '42 Secret Garden Lane, Gachibowli';
export const PLACE = 'The Hidden Courtyard';

export const idem = (): [string, string] => [
  'Idempotency-Key',
  `k-${Date.now()}-${Math.random().toString(36).slice(2)}`,
];

export async function verify(h: Harness, m: Member): Promise<void> {
  await h.pool.query('UPDATE users SET verified_at = now() WHERE id = $1', [m.id]);
}

/** A verified, onboarded member (hosts must be verified while `require_verification_to_host` is on). */
export async function verifiedMember(
  h: Harness,
  overrides: Record<string, unknown> = {},
): Promise<Member> {
  const m = await member(h, overrides);
  await verify(h, m);
  return m;
}

export async function planBody(
  h: Harness,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const [category] = await interestIds(h, 1);
  const start = Date.now() + 3 * 86_400_000;
  return {
    title: 'Sunset frisbee',
    description: 'Bring water. Beginners welcome.',
    categoryInterestId: category,
    where: { point: SPOT, address: ADDRESS, placeName: PLACE },
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * 3_600_000).toISOString(),
    capacity: 10,
    ...overrides,
  };
}

export async function plot(
  h: Harness,
  host: Member,
  overrides: Record<string, unknown> = {},
): Promise<EventDetail> {
  const res = await request(h.http)
    .post('/v1/events')
    .set(...bearer(host.token))
    .set(...idem())
    .send(await planBody(h, overrides));
  if (res.status !== 201) throw new Error(`plot failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as EventDetail;
}

export const rsvp = (
  h: Harness,
  m: Member,
  eventId: string,
  body: Record<string, unknown> = { status: 'going' },
) =>
  request(h.http)
    .put(`/v1/events/${eventId}/rsvp`)
    .set(...bearer(m.token))
    .set(...idem())
    .send(body);

export const detail = (h: Harness, m: Member, eventId: string) =>
  request(h.http)
    .get(`/v1/events/${eventId}`)
    .set(...bearer(m.token));

/** Moves an event in time (so tests can reach the reveal / check-in window) and drops its cache entry. */
export async function shiftEvent(
  h: Harness,
  eventId: string,
  startsInMs: number,
  durationMs = 2 * 3_600_000,
): Promise<void> {
  const start = new Date(Date.now() + startsInMs);
  await h.pool.query('UPDATE events SET starts_at = $2, ends_at = $3 WHERE id = $1', [
    eventId,
    start,
    new Date(start.getTime() + durationMs),
  ]);
  await h.app.get(EventStore).invalidate(eventId);
}

export async function outboxFor(
  h: Harness,
  eventId: string,
  type: string,
): Promise<Record<string, unknown>[]> {
  const { rows } = await h.pool.query<{ payload: Record<string, unknown> }>(
    'SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = $2 ORDER BY created_at',
    [eventId, type],
  );
  return rows.map((r) => r.payload);
}
