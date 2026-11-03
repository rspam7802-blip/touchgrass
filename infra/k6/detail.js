// Event detail load test (F-EVT-*, section 2 target: p95 < 300 ms): members open seeded plans by id, the
// hottest path after the feed (cached core + live counts + viewer state, mystery-safe serializer).
//
//   TRUST_PROXY_HOPS=1 node --env-file=../../.env apps/api/dist/main.js
//   docker run --rm --network host -v "$PWD/infra/k6:/scripts" grafana/k6:1.4.2 run /scripts/detail.js
//
// Env: API_URL (default http://localhost:4000), VUS (members, default 40), RATE (requests/s, default 100),
// DURATION (default 30s), FIRST_MEMBER (seeded member number to start from, default 40).
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:4000';
const VUS = Number(__ENV.VUS || 40);
const RATE = Number(__ENV.RATE || 100);
const FIRST_MEMBER = Number(__ENV.FIRST_MEMBER || 40);
const detailLatency = new Trend('detail_latency', true);

export const options = {
  scenarios: {
    open_plan: {
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
    detail_latency: ['p(95)<300'],
  },
};

const ip = (n) => `10.79.${Math.floor(n / 250)}.${(n % 250) + 1}`;
const headers = (token, n) => ({
  'Content-Type': 'application/json',
  'X-Forwarded-For': ip(n),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export function setup() {
  const tokens = [];
  for (let i = 0; i < VUS; i += 1) {
    const phone = `+9190000${10000 + FIRST_MEMBER + i}`;
    const req = http.post(`${API}/v1/auth/otp/request`, JSON.stringify({ phone }), {
      headers: headers(null, i),
    });
    if (req.status !== 200) fail(`otp request ${req.status} ${req.body}`);
    const res = http.post(
      `${API}/v1/auth/otp/verify`,
      JSON.stringify({
        phone,
        code: '000000',
        device: {
          deviceId: `k6-detail-${i}`,
          platform: 'android',
          name: 'k6',
          appVersion: '0.1.0',
        },
      }),
      { headers: headers(null, i) },
    );
    if (res.status !== 200) fail(`verify ${res.status} ${res.body}`);
    tokens.push(res.json('accessToken'));
  }
  // Public, published seeded plans every member may open.
  const ids = [];
  for (let n = 0; n < 100 && ids.length < 30; n += 1) {
    const slug = `seedev${String(n).padStart(3, '0')}`;
    // Private and draft plans answer 404 here; that's expected, not an error.
    const r = http.get(`${API}/v1/events/by-slug/${slug}`, {
      headers: headers(tokens[0], 0),
      responseCallback: http.expectedStatuses(200, 404),
    });
    if (r.status === 200 && r.json('visibility') === 'public' && r.json('status') === 'published')
      ids.push(r.json('id'));
  }
  if (ids.length === 0) fail('no public seeded plans');
  return { tokens, ids };
}

export default function (data) {
  const n = (__VU - 1) % data.tokens.length;
  const id = data.ids[__ITER % data.ids.length];
  const res = http.get(`${API}/v1/events/${id}`, { headers: headers(data.tokens[n], n) });
  detailLatency.add(res.timings.duration);
  check(res, { 'detail ok': (r) => r.status === 200 });
}
