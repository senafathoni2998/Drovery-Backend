// Drovery PURE-I/O load scenario (k6) — isolates the I/O ceiling from the bcrypt wall.
//
// The default scenario.js journey is dominated by cost-12 bcrypt on signup (prior run:
// step_signup p95 7.72s, CPU-bound), which MASKS how the I/O tiers actually scale. This
// scenario AMORTIZES auth: it authenticates a POOL of users exactly ONCE in setup() and
// every steady-state iteration REUSES a JWT — so the per-iteration journey does ZERO
// bcrypt and the step latencies reflect DB / PgBouncer / queue I/O, not CPU hashing.
// That per-node I/O throughput is the input the capacity model projects to 100k DAU.
//
// Two selectable journeys via SCENARIO (run.sh wires it through):
//   sudo SCENARIO=io   API=3 WORKER=3 VUS=100 HOLD=120s bash loadtest/run.sh  # write+queue+read
//   sudo SCENARIO=read API=3 WORKER=3 VUS=200 HOLD=120s bash loadtest/run.sh  # read-only (list+get)
//
// SELF-CONTAINED: setup() creates the user pool through the real API (signup, falling back
// to login if the user already exists from a prior warm-stack run) — no separate DB seed,
// no ts-node, no Dockerfile change, and src/auth is UNTOUCHED (the bcrypt cost is paid once
// here, never weakened). Knobs: POOL, SEED_DELIVERIES, USER_PREFIX, USER_PASSWORD.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://lb';
const VUS = Number(__ENV.VUS || 50);
const SCENARIO = __ENV.SCENARIO || 'io'; // 'io' | 'read'
const POOL = Number(__ENV.POOL || 50); // # of pooled users authenticated in setup()
const SEED_DELIVERIES = Number(__ENV.SEED_DELIVERIES || 1); // per pooled user, for the read journey
const USER_PREFIX = __ENV.USER_PREFIX || 'ltuser';
const USER_PASSWORD = __ENV.USER_PASSWORD || 'loadtest123';

// Per-step latency so a regression in one tier is visible (not just the global p95).
const tCreate = new Trend('step_create_delivery', true);
const tList = new Trend('step_list', true);
const tGet = new Trend('step_get_one', true);

// Greater Bandung (within the serviceable radius) → passes assertServiceable, and providing
// coords skips the geocoder so we're not load-testing nominatim. (Same pair as scenario.js.)
const FROM = { lat: -6.9218, lng: 107.6071 };
const TO = { lat: -6.9175, lng: 107.6191 };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const authHdr = (t) => ({
  headers: { ...JSON_HEADERS, Authorization: `Bearer ${t}` },
});
// Read requests are tagged kind:read so the global p95 threshold scopes to them (create rides
// its own step Trend; setup samples stay untagged → excluded).
const readParams = (t) => ({ ...authHdr(t), tags: { kind: 'read' } });

const DELIVERY_BODY = JSON.stringify({
  fromAddress: 'Jl. Asia Afrika, Bandung',
  toAddress: 'Jl. Braga, Bandung',
  receiver: 'Recipient',
  packages: '1 box',
  packageSize: 'Small',
  packageWeight: 1.5,
  packageTypes: ['document'],
  pickupTime: '10:00 AM',
  fromLat: FROM.lat,
  fromLng: FROM.lng,
  toLat: TO.lat,
  toLng: TO.lng,
});

// Only the selected journey is registered, so the other contributes 0 iterations.
const STAGES = [
  { duration: __ENV.RAMP || '30s', target: VUS },
  { duration: __ENV.HOLD || '120s', target: VUS },
  { duration: '10s', target: 0 },
];
const EXEC = { io: 'ioJourney', read: 'readJourney' }[SCENARIO] || 'ioJourney';

// setup() primes the pool SEQUENTIALLY (one cost-12 bcrypt each, + SEED_DELIVERIES creates per
// user for the read journey). On a CPU-capped node that's ~1–2s/user, so scale the timeout with
// POOL rather than a fixed cap a large POOL would silently blow (floored at the old 300s).
const SETUP_TIMEOUT_S = Math.max(
  300,
  Math.ceil(POOL * 2 * (SCENARIO === 'read' ? 1 + SEED_DELIVERIES * 0.5 : 1)),
);

export const options = {
  setupTimeout: `${SETUP_TIMEOUT_S}s`,
  scenarios: {
    active: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: '10s',
      exec: EXEC,
    },
  },
  // Pure-I/O targets: NO bcrypt in the hot path, so p95 is tight (single local box still adds
  // contention — tighten further for a real cluster). The global duration threshold is scoped
  // to {kind:read} so the heavier create path (its own step_create_delivery p95<800 budget)
  // can't fail it, and setup()'s cost-12 signup/login samples (untagged) are excluded.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<500'],
    checks: ['rate>0.99'],
    step_create_delivery: ['p(95)<800'], // write + mock payment + BullMQ enqueue does more than a read
    step_list: ['p(95)<300'],
    step_get_one: ['p(95)<300'],
  },
};

const today = () => new Date().toISOString().slice(0, 10); // immediate (not scheduled)

// Authenticate ONE pooled user: try signup; if the user already exists (409 from a prior
// warm-stack run), log in instead. Returns a JWT or null. The bcrypt cost is paid HERE,
// once, before the measured window — never per iteration.
function authOne(i) {
  const email = `${USER_PREFIX}${i}@loadtest.local`;
  let res = http.post(
    `${BASE}/api/v1/auth/signup`,
    JSON.stringify({ name: `LoadTest ${i}`, email, password: USER_PASSWORD }),
    // A 409 (user exists from a prior warm-stack run) is EXPECTED and drives the login
    // fallback below — mark it non-failing so it doesn't pollute http_req_failed.
    { headers: JSON_HEADERS, responseCallback: http.expectedStatuses(201, 409) },
  );
  if (res.status !== 201) {
    // Already registered (409) or otherwise not created — fall back to login.
    res = http.post(
      `${BASE}/api/v1/auth/login`,
      JSON.stringify({ email, password: USER_PASSWORD }),
      { headers: JSON_HEADERS },
    );
  }
  return res.status === 201 || res.status === 200
    ? res.json('data.accessToken')
    : null;
}

// Runs ONCE; its return value is deep-cloned to every VU as the `data` arg.
export function setup() {
  const tokens = [];
  for (let i = 0; i < POOL; i++) {
    const token = authOne(i);
    if (!token) continue;
    tokens.push(token);
    // The read journey needs each user to OWN at least one delivery so list is non-empty
    // and get-one has a real id. Seed a few here (the io journey makes its own).
    if (SCENARIO === 'read') {
      for (let d = 0; d < SEED_DELIVERIES; d++) {
        http.post(
          `${BASE}/api/v1/deliveries`,
          JSON.stringify({ ...JSON.parse(DELIVERY_BODY), pickupDate: today() }),
          authHdr(token),
        );
      }
    }
  }
  if (tokens.length === 0) {
    throw new Error(
      'setup: could not authenticate any pooled user — is the stack up and migrated?',
    );
  }
  console.log(
    `setup: authenticated ${tokens.length}/${POOL} pooled users` +
      (SCENARIO === 'read' ? ` (+${SEED_DELIVERIES} deliveries each)` : '') +
      ' — zero per-iteration bcrypt from here.',
  );
  return { tokens };
}

// (b) WRITE + QUEUE + READ I/O — reuses a pooled token; NO auth per iteration. Each create
// is a SIMULATED delivery (default trackingSource) → fans 17 lifecycle jobs to the worker
// tier, so this journey also drives the queue the drain probe measures.
export function ioJourney(data) {
  const token = data.tokens[__VU % data.tokens.length];
  let res = http.post(
    `${BASE}/api/v1/deliveries`,
    JSON.stringify({ ...JSON.parse(DELIVERY_BODY), pickupDate: today() }),
    authHdr(token),
  );
  tCreate.add(res.timings.duration);
  check(res, { 'create 201': (r) => r.status === 201 });
  const id = res.json('data.id');

  res = http.get(`${BASE}/api/v1/deliveries`, readParams(token));
  tList.add(res.timings.duration);
  check(res, { 'list 200': (r) => r.status === 200 });

  if (id) {
    res = http.get(`${BASE}/api/v1/deliveries/${id}`, readParams(token));
    tGet.add(res.timings.duration);
    check(res, { 'get one 200': (r) => r.status === 200 });
  }
  sleep(1); // ~1 iteration/VU/sec think-time
}

// (c) READ-ONLY I/O — list + get of an existing delivery (the dominant real-world traffic).
// Exercises the partitioned findMany-by-userId + findFirst-by-id read paths with ZERO writes.
export function readJourney(data) {
  const token = data.tokens[__VU % data.tokens.length];
  let res = http.get(`${BASE}/api/v1/deliveries`, readParams(token));
  tList.add(res.timings.duration);
  check(res, { 'list 200': (r) => r.status === 200 });
  const items = res.json('data.items');
  const id = items && items.length ? items[0].id : null;
  if (id) {
    res = http.get(`${BASE}/api/v1/deliveries/${id}`, readParams(token));
    tGet.add(res.timings.duration);
    check(res, { 'get one 200': (r) => r.status === 200 });
  }
  sleep(1);
}
