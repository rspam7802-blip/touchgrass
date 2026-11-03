// Chat load test (F-CHT-01/04): pairs of squad members send messages to each other (with offline-queue
// retries reusing the client id), read their history and mark it read. Asserts latency/error SLOs and that a
// retried client id never creates a second message.
//
//   TRUST_PROXY_HOPS=1 node --env-file=../../.env apps/api/dist/main.js
//   docker run --rm --network host -v "$PWD/infra/k6:/scripts" grafana/k6:1.4.2 run /scripts/chat.js
//
// Env: API_URL (default http://localhost:4000), PAIRS (default 15), RATE (iterations/s, default 20; keep each member under the 60/min send limit),
// DURATION (default 30s), FIRST_MEMBER (seeded member number; consecutive members are squad, default 41).
import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:4000';
const PAIRS = Number(__ENV.PAIRS || 15);
const RATE = Number(__ENV.RATE || 20);
const FIRST_MEMBER = Number(__ENV.FIRST_MEMBER || 41);
const sendLatency = new Trend('send_latency', true);
const historyLatency = new Trend('history_latency', true);
const duplicates = new Counter('duplicates');

export const options = {
  scenarios: {
    chatter: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: PAIRS * 2,
      maxVUs: PAIRS * 2,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    send_latency: ['p(95)<300'],
    history_latency: ['p(95)<300'],
    duplicates: ['count==0'],
  },
};

const ip = (n) => `10.79.${Math.floor(n / 250)}.${(n % 250) + 1}`;
const headers = (token, n) => ({
  'Content-Type': 'application/json',
  'X-Forwarded-For': ip(n),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

function signIn(memberNumber, n) {
  const phone = `+9190000${10000 + memberNumber}`;
  const req = http.post(`${API}/v1/auth/otp/request`, JSON.stringify({ phone }), {
    headers: headers(null, n),
  });
  if (req.status !== 200) fail(`otp request ${req.status} ${req.body}`);
  const res = http.post(
    `${API}/v1/auth/otp/verify`,
    JSON.stringify({
      phone,
      code: '000000',
      device: {
        deviceId: `k6-chat-device-${n}`,
        platform: 'android',
        name: 'k6',
        appVersion: '0.1.0',
      },
    }),
    { headers: headers(null, n) },
  );
  if (res.status !== 200) fail(`verify ${res.status} ${res.body}`);
  return res.json('accessToken');
}

/** Pairs (k, k+1) are squad in the seeded ring, so they chat directly. */
export function setup() {
  const users = [];
  for (let i = 0; i < PAIRS * 2; i += 1) users.push(signIn(FIRST_MEMBER + i, i));
  const chats = [];
  for (let p = 0; p < PAIRS; p += 1) {
    const a = users[2 * p];
    const peer = http
      .get(`${API}/v1/me`, { headers: headers(users[2 * p + 1], 2 * p + 1) })
      .json('id');
    const conv = http.post(`${API}/v1/chats/direct`, JSON.stringify({ userId: peer }), {
      headers: headers(a, 2 * p),
    });
    if (conv.status !== 201 || conv.json('state') !== 'active')
      fail(`start ${conv.status} ${conv.body}`);
    chats.push(conv.json('id'));
  }
  return { users, chats };
}

export default function (data) {
  const n = (__VU - 1) % data.users.length;
  const token = data.users[n];
  const chat = data.chats[Math.floor(n / 2)];
  const h = { headers: headers(token, n) };
  const clientId = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({ clientId, body: `hello ${__ITER}` });
  const sent = http.post(`${API}/v1/chats/${chat}/messages`, body, h);
  sendLatency.add(sent.timings.duration);
  check(sent, { 'send ok': (r) => r.status === 201 });
  // An offline-queue retry with the same client id must return the same message.
  if (__ITER % 4 === 0) {
    const retry = http.post(`${API}/v1/chats/${chat}/messages`, body, h);
    sendLatency.add(retry.timings.duration);
    if (retry.status === 201 && sent.status === 201 && retry.json('id') !== sent.json('id'))
      duplicates.add(1);
  }
  const history = http.get(`${API}/v1/chats/${chat}/messages?limit=40`, h);
  historyLatency.add(history.timings.duration);
  check(history, { 'history ok': (r) => r.status === 200 });
  if (sent.status === 201) {
    const read = http.post(
      `${API}/v1/chats/${chat}/read`,
      JSON.stringify({ messageId: sent.json('id') }),
      h,
    );
    check(read, { 'read ok': (r) => r.status === 204 });
  }
}
