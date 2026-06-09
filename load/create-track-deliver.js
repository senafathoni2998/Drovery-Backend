import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

import { CFG, getToken, authHeaders, newDeliveryPayload } from './lib/common.js';

const createDur = new Trend('create_delivery_duration', true);
const trackDur = new Trend('track_poll_duration', true);
const bizErrors = new Rate('business_errors');

// Pick a scenario: SCENARIO=smoke|ramp|throttle_proof (default ramp).
const SCEN = __ENV.SCENARIO || 'ramp';

const allScenarios = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
    exec: 'flow',
    tags: { scen: 'smoke' },
  },
  ramp: {
    executor: 'ramping-vus',
    startVUs: 0,
    exec: 'flow',
    tags: { scen: 'ramp' },
    stages: [
      { duration: '1m', target: 20 }, // warm up
      { duration: '2m', target: 50 }, // ramp
      { duration: '3m', target: 100 }, // sustained (compare 1 vs 2 api replicas here)
      { duration: '1m', target: 0 }, // ramp down
    ],
  },
  throttle_proof: {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 1,
    exec: 'throttleProof',
    tags: { scen: 'throttle' },
  },
};

export const options = {
  scenarios: { [SCEN]: allScenarios[SCEN] },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
    business_errors: ['rate<0.01'],
    create_delivery_duration: ['p(95)<600'],
    track_poll_duration: ['p(95)<300'],
  },
};

// create -> poll tracking a few times (the mobile app polls /deliveries/:id ~4s).
export function flow() {
  const token = getToken(); // logs in once per VU, reused thereafter
  const c = http.post(`${CFG.BASE_URL}/deliveries`, newDeliveryPayload(), {
    ...authHeaders(token),
    tags: { name: 'create_delivery' },
  });
  createDur.add(c.timings.duration);
  const created = check(c, {
    'create 2xx': (r) => r.status === 201 || r.status === 200,
    'has id': (r) => !!r.json('data.id'),
  });
  bizErrors.add(!created);
  if (!created) {
    sleep(1);
    return;
  }
  const id = c.json('data.id');
  for (let i = 0; i < 3; i++) {
    const t = http.get(`${CFG.BASE_URL}/deliveries/${id}`, {
      ...authHeaders(token),
      tags: { name: 'track_delivery' },
    });
    trackDur.add(t.timings.duration);
    bizErrors.add(!check(t, { 'track 200': (r) => r.status === 200 }));
    sleep(1);
  }
}

// Proves the Redis-backed limiter is shared/correct across replicas: with the
// bypass OFF, the 11th /auth hit must 429 regardless of which replica answers.
export function throttleProof() {
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const r = http.post(
      `${CFG.BASE_URL}/auth/login`,
      JSON.stringify({ email: 'nobody@drovery.com', password: 'x' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_burst' } },
    );
    if (r.status === 429) got429 = true;
  }
  check(null, {
    'auth throttle enforced (a 429 within 12 hits)': () => got429,
  });
}
