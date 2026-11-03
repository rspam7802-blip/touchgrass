// RSVP load test (F-EVT-05/06/08): many members pull up to and drop out of the same plan at once.
// Asserts latency/error SLOs and that the plan is never over capacity.
//
//   API must trust one proxy hop so each virtual user gets its own client IP (per-IP OTP limits):
//   TRUST_PROXY_HOPS=1 node apps/api/dist/main.js
//   docker run --rm --network host -v "$PWD/infra/k6:/scripts" grafana/k6:1.4.2 run /scripts/rsvp.js
//
// Env: API_URL (default http://localhost:4000), VUS (members, default 40), RATE (default 20/s), DURATION (30s), SLUG (seeded public plan, default seedev001),
// FIRST_MEMBER (seeded member number to start from, default 101).
import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:4000';
const VUS = Number(__ENV.VUS || 40);
const SLUG = __ENV.SLUG || 'seedev001';
// Seeded member numbers to sign in as; change between back-to-back runs (OTP resend cooldown per phone).
const FIRST_MEMBER = Number(__ENV.FIRST_MEMBER || 101);
const rsvpLatency = new Trend('rsvp_latency', true);
const overbooked = new Counter('overbooked');

// Open model: a steady stream of pull-ups and drop-outs on ONE plan (the hot-spot case: the lock serialises
// them). RATE iterations/s = 2×RATE RSVP writes/s against a single API instance.
const RATE = Number(__ENV.RATE || 20);
export const options = {
  scenarios: {
    hot_plan: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: VUS,
      maxVUs: VUS,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    rsvp_latency: ['p(95)<500', 'p(99)<1000'],
    overbooked: ['count==0'],
  },
};

const ip = (n) => `10.77.${Math.floor(n / 250)}.${(n % 250) + 1}`;
const json = (token, n) => ({
  headers: {
    'Content-Type': 'application/json',
    'X-Forwarded-For': ip(n),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
});

/** Seeded members FIRST_MEMBER.. sign in with the dev OTP; returns their tokens and the plan id. */
export function setup() {
  const tokens = [];
  for (let i = 0; i < VUS; i += 1) {
    const phone = `+9190000${10000 + FIRST_MEMBER + i}`;
    const req = http.post(`${API}/v1/auth/otp/request`, JSON.stringify({ phone }), json(null, i));
    if (req.status !== 200) fail(`otp request ${req.status} ${req.body}`);
    const res = http.post(
      `${API}/v1/auth/otp/verify`,
      JSON.stringify({
        phone,
        code: '000000',
        device: {
          deviceId: `k6-device-${i}-000`,
          platform: 'android',
          name: 'k6',
          appVersion: '0.1.0',
        },
      }),
      json(null, i),
    );
    if (res.status !== 200) fail(`verify ${res.status} ${res.body}`);
    tokens.push(res.json('accessToken'));
  }
  const event = http.get(`${API}/v1/events/by-slug/${SLUG}`, json(tokens[0], 0));
  if (event.status !== 200) fail(`event ${event.status} ${event.body}`);
  // Hosts cannot pull up to their own plan; leave them out of the crowd.
  const crowd = tokens.filter((token, i) => {
    const view = http.get(`${API}/v1/events/${event.json('id')}`, json(token, i));
    return view.status === 200 && view.json('viewer.isHost') === false;
  });
  return { tokens: crowd, eventId: event.json('id'), capacity: event.json('capacity') };
}

export default function (data) {
  // VUs map onto the crowd round-robin (hosts were dropped, so a couple of VUs may share a member).
  const n = (__VU - 1) % data.tokens.length;
  const token = data.tokens[n];
  const going = http.put(
    `${API}/v1/events/${data.eventId}/rsvp`,
    JSON.stringify({ status: 'going' }),
    {
      headers: {
        ...json(token, n).headers,
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
      },
    },
  );
  rsvpLatency.add(going.timings.duration);
  if (!check(going, { 'pull up ok': (r) => r.status === 200 }))
    console.warn(`pull up ${going.status} ${going.body}`);
  if (going.status === 200 && going.json('event.goingCount') > data.capacity) overbooked.add(1);
  const leave = http.del(`${API}/v1/events/${data.eventId}/rsvp`, null, json(token, n));
  rsvpLatency.add(leave.timings.duration);
  check(leave, { 'drop out ok': (r) => r.status === 204 });
}

export function teardown(data) {
  const event = http.get(`${API}/v1/events/${data.eventId}`, json(data.tokens[0], 0));
  if (event.json('goingCount') > data.capacity) overbooked.add(1);
}
