// Discovery feed load test (F-DSC-01/02/03/09): members open the feed (first page + next page), switch
// filters, open the map and search. Asserts latency and error SLOs on a single API instance.
//
//   TRUST_PROXY_HOPS=1 node --env-file=../../.env apps/api/dist/main.js
//   docker run --rm --network host -v "$PWD/infra/k6:/scripts" grafana/k6:1.4.2 run /scripts/feed.js
//
// Env: API_URL (default http://localhost:4000), VUS (members, default 30), RATE (iterations/s, default 15),
// DURATION (default 30s), FIRST_MEMBER (seeded member number to start from, default 1).
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:4000';
const VUS = Number(__ENV.VUS || 30);
const RATE = Number(__ENV.RATE || 15);
const FIRST_MEMBER = Number(__ENV.FIRST_MEMBER || 1);
const feedLatency = new Trend('feed_latency', true);
const mapLatency = new Trend('map_latency', true);
const searchLatency = new Trend('search_latency', true);

export const options = {
  scenarios: {
    browse: {
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
    feed_latency: ['p(95)<300'],
    map_latency: ['p(95)<500'],
    search_latency: ['p(95)<500'],
  },
};

const ip = (n) => `10.78.${Math.floor(n / 250)}.${(n % 250) + 1}`;
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
          deviceId: `k6-feed-device-${i}`,
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
  return { tokens };
}

const FILTERS = [
  '',
  '&when=tonight',
  '&when=weekend',
  '&soloFriendly=true',
  '&sort=nearest',
  '&free=true&radiusKm=20',
];
const WORDS = ['chai', 'board', 'run', 'walk', 'quiz', 'coffee'];

export default function (data) {
  const n = (__VU - 1) % data.tokens.length;
  const h = { headers: headers(data.tokens[n], n) };
  const filter = FILTERS[__ITER % FILTERS.length];
  const first = http.get(`${API}/v1/discover/feed?limit=20${filter}`, h);
  feedLatency.add(first.timings.duration);
  check(first, { 'feed ok': (r) => r.status === 200 });
  const cursor = first.status === 200 ? first.json('nextCursor') : null;
  if (cursor) {
    const next = http.get(
      `${API}/v1/discover/feed?limit=20${filter}&cursor=${encodeURIComponent(cursor)}`,
      h,
    );
    feedLatency.add(next.timings.duration);
    check(next, { 'next page ok': (r) => r.status === 200 });
  }
  if (__ITER % 3 === 0) {
    const map = http.get(`${API}/v1/discover/map?bbox=78.30,17.38,78.48,17.50&zoom=12${filter}`, h);
    mapLatency.add(map.timings.duration);
    check(map, { 'map ok': (r) => r.status === 200 });
  }
  if (__ITER % 3 === 1) {
    const s = http.get(`${API}/v1/discover/search?q=${WORDS[__ITER % WORDS.length]}`, h);
    searchLatency.add(s.timings.duration);
    check(s, { 'search ok': (r) => r.status === 200 });
  }
}
