// Drovery load scenario (k6). A realistic per-VU journey that exercises every scaled tier:
//   signup (DB write + JWT)  →  create delivery (write + payment + BullMQ enqueue → WORKER)
//   →  list deliveries (read)  →  poll one delivery (read)
//
// Run via the compose overlay (k6 in a container, no host install):
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml \
//     run --rm -e VUS=50 -e HOLD=60s k6
//
// Knobs (env): VUS (peak virtual users), RAMP, HOLD durations, BASE_URL.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://lb';
const VUS = Number(__ENV.VUS || 30);

// Per-step latency so a regression in one tier is visible (not just the global p95).
const tSignup = new Trend('step_signup', true);
const tCreate = new Trend('step_create_delivery', true);
const tList = new Trend('step_list', true);
const tGet = new Trend('step_get_one', true);

export const options = {
  scenarios: {
    journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '20s', target: VUS },
        { duration: __ENV.HOLD || '40s', target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  // Local single-machine targets (everything — DB, pgbouncer, redis, API×N, worker×N, LB,
  // k6 — shares one box, so latencies run higher than a real cluster). Tighten for cloud.
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.98'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const auth = (token) => ({
  headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
});

// Greater Bandung (within the serviceable radius) → passes assertServiceable, and providing
// coords skips the geocoder so we're not load-testing nominatim.
const FROM = { lat: -6.9218, lng: 107.6071 };
const TO = { lat: -6.9175, lng: 107.6191 };

export default function () {
  // Unique user per iteration (write load); collisions are effectively impossible.
  const email = `lt_${__VU}_${__ITER}_${Date.now()}@loadtest.local`;

  let res = http.post(
    `${BASE}/api/v1/auth/signup`,
    JSON.stringify({ name: 'Load Test', email, password: 'loadtest123' }),
    { headers: JSON_HEADERS },
  );
  tSignup.add(res.timings.duration);
  check(res, { 'signup 201': (r) => r.status === 201 });
  const token = res.json('data.accessToken');
  if (!token) {
    sleep(1);
    return;
  }

  const today = new Date().toISOString().slice(0, 10); // immediate (not a scheduled/too-far delivery)
  res = http.post(
    `${BASE}/api/v1/deliveries`,
    JSON.stringify({
      fromAddress: 'Jl. Asia Afrika, Bandung',
      toAddress: 'Jl. Braga, Bandung',
      receiver: 'Recipient',
      packages: '1 box',
      packageSize: 'Small',
      packageWeight: 1.5,
      packageTypes: ['document'],
      pickupDate: today,
      pickupTime: '10:00 AM',
      fromLat: FROM.lat,
      fromLng: FROM.lng,
      toLat: TO.lat,
      toLng: TO.lng,
    }),
    auth(token),
  );
  tCreate.add(res.timings.duration);
  check(res, { 'create 201': (r) => r.status === 201 });
  const deliveryId = res.json('data.id');

  res = http.get(`${BASE}/api/v1/deliveries`, auth(token));
  tList.add(res.timings.duration);
  check(res, { 'list 200': (r) => r.status === 200 });

  if (deliveryId) {
    res = http.get(`${BASE}/api/v1/deliveries/${deliveryId}`, auth(token));
    tGet.add(res.timings.duration);
    check(res, { 'get one 200': (r) => r.status === 200 });
  }

  sleep(1); // ~1 iteration/VU/sec think-time
}
