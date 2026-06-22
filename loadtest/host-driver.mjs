#!/usr/bin/env node
// Docker-free load driver (zero new deps: global fetch + the existing `pg`). A counterpart to
// the k6 scenario for hosts without Docker. Drives the same per-VU journey — create delivery
// (write + payment + BullMQ enqueue → worker) → list → poll — against an api booted on the host,
// with the 1M+ scaling flags ON, so the run exercises the debit-first saga (credits-funded users
// → the R2 reservation), the transactional outbox (referral), the tracking hot-store, and sharded
// pub/sub. Seeds + tears down its own user pool directly via pg.
//
//   BASE=http://localhost:3000/api/v1 POOL=40 VUS=50 HOLD=45 node loadtest/host-driver.mjs
import pg from 'pg';

const BASE = process.env.BASE || 'http://localhost:3000/api/v1';
const POOL = Number(process.env.POOL || 40);
const VUS = Number(process.env.VUS || 50);
const HOLD_MS = Number(process.env.HOLD || 45) * 1000;
const API_METRICS = process.env.API_METRICS || `${BASE}/metrics`;
const WORKER_METRICS =
  process.env.WORKER_METRICS || 'http://localhost:9091/metrics';
const EMAIL_PREFIX = 'hostlt-';

const FROM = { lat: -6.9218, lng: 107.6071 };
const TO = { lat: -6.9175, lng: 107.6191 };
const J = { 'Content-Type': 'application/json' };
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const ms = () => Number(process.hrtime.bigint() / 1000000n);

async function signup(i) {
  const email = `${EMAIL_PREFIX}${i}-${Date.now()}@loadtest.local`;
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ name: 'Load Test', email, password: 'loadtest123' }),
  });
  if (res.status !== 201) throw new Error(`signup ${res.status}`);
  const body = await res.json();
  return { email, token: body.data.accessToken };
}

function makeCreateBody() {
  const today = new Date().toISOString().slice(0, 10);
  return JSON.stringify({
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
    useCredits: true, // exercise the debit-first reservation (R2) on every create
  });
}

async function scrape(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const text = await res.text();
    const grab = (name) =>
      text
        .split('\n')
        .filter((l) => l.startsWith(name) && !l.startsWith('#'))
        .reduce((sum, l) => sum + Number(l.trim().split(/\s+/).pop() || 0), 0);
    return {
      http_total: grab('drovery_http_requests_total'),
      http_5xx: text
        .split('\n')
        .filter((l) => l.startsWith('drovery_http_requests_total') && /status="5/.test(l))
        .reduce((s, l) => s + Number(l.trim().split(/\s+/).pop() || 0), 0),
      outbox_processed: grab('drovery_outbox_processed_total'),
      outbox_pending: grab('drovery_outbox_pending'),
      queue_waiting: text
        .split('\n')
        .filter((l) => l.startsWith('drovery_queue_jobs') && /state="waiting"/.test(l))
        .reduce((s, l) => s + Number(l.trim().split(/\s+/).pop() || 0), 0),
      orphan_reaped: grab('drovery_orphan_reservations_reaped_total'),
    };
  } catch {
    return {};
  }
}

async function main() {
  console.log(`# Drovery docker-free load run`);
  console.log(`BASE=${BASE} POOL=${POOL} VUS=${VUS} HOLD=${HOLD_MS / 1000}s`);

  // 1. SETUP — create a user pool through the real API, then fund them so every create()
  //    exercises the debit-first R2 reservation (a huge balance so no user runs dry mid-run).
  process.stdout.write(`setup: creating ${POOL} users ... `);
  const users = [];
  for (let i = 0; i < POOL; i++) {
    try {
      users.push(await signup(i));
    } catch (e) {
      /* tolerate a few signup failures */
    }
  }
  if (!users.length) throw new Error('no users created — is the api up?');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    `UPDATE "users" SET "creditBalance" = 1000000 WHERE email LIKE $1`,
    [`${EMAIL_PREFIX}%`],
  );
  console.log(`${users.length} users, funded.`);

  const before = await scrape(WORKER_METRICS);
  const beforeApi = await scrape(API_METRICS);

  // 2. LOAD — VUS concurrent loops until the deadline. Each iteration: create → list → get.
  const lat = { create: [], list: [], get: [] };
  let ok = 0;
  const err = { create: 0, list: 0, get: 0 };
  const deadline = Date.now() + HOLD_MS;

  const step = async (fn, bucket) => {
    const t = ms();
    try {
      const res = await fn();
      const dur = ms() - t;
      lat[bucket].push(dur);
      return res;
    } catch {
      err[bucket]++;
      return null;
    }
  };

  const vu = async () => {
    while (Date.now() < deadline) {
      const u = users[Math.floor(Math.random() * users.length)];
      const h = { ...J, Authorization: `Bearer ${u.token}` };
      const created = await step(async () => {
        const r = await fetch(`${BASE}/deliveries`, {
          method: 'POST',
          headers: h,
          body: makeCreateBody(),
        });
        if (r.status !== 201) throw new Error(`create ${r.status}`);
        return (await r.json()).data;
      }, 'create');
      await step(async () => {
        const r = await fetch(`${BASE}/deliveries`, { headers: h });
        if (r.status !== 200) throw new Error(`list ${r.status}`);
      }, 'list');
      if (created?.id) {
        await step(async () => {
          const r = await fetch(`${BASE}/deliveries/${created.id}`, { headers: h });
          if (r.status !== 200) throw new Error(`get ${r.status}`);
        }, 'get');
      }
      if (created) ok++;
    }
  };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: VUS }, () => vu()));
  const elapsed = (Date.now() - t0) / 1000;

  // Let the worker dispatch any enqueued outbox events before the after-snapshot.
  await new Promise((r) => setTimeout(r, 6000));
  const after = await scrape(WORKER_METRICS);
  const afterApi = await scrape(API_METRICS);

  // 3. REPORT.
  const totalReqs =
    lat.create.length + lat.list.length + lat.get.length;
  const totalErr = err.create + err.list + err.get;
  const rps = (totalReqs / elapsed).toFixed(1);
  const line = (name, a, e) =>
    `  ${name.padEnd(8)} n=${String(a.length).padStart(5)}  p50=${String(pct(a, 50)).padStart(5)}ms  p95=${String(pct(a, 95)).padStart(5)}ms  p99=${String(pct(a, 99)).padStart(5)}ms  err=${e}`;

  console.log(`\n## Results (${elapsed.toFixed(0)}s wall)`);
  console.log(`  journeys completed: ${ok}`);
  console.log(`  total requests:     ${totalReqs}  (${rps} req/s)`);
  console.log(
    `  errors:             ${totalErr}  (${((totalErr / (totalReqs + totalErr || 1)) * 100).toFixed(2)}%)`,
  );
  console.log(line('create', lat.create, err.create));
  console.log(line('list', lat.list, err.list));
  console.log(line('get', lat.get, err.get));
  console.log(`\n## Scaling mechanisms (metrics delta)`);
  const d = (k) => (after[k] ?? 0) - (before[k] ?? 0);
  const dApi = (k) => (afterApi[k] ?? 0) - (beforeApi[k] ?? 0);
  console.log(`  outbox events processed (worker): ${d('outbox_processed')}`);
  console.log(`  outbox pending now:               ${after.outbox_pending ?? 'n/a'}`);
  console.log(`  orphan reservations reaped:       ${after.orphan_reaped ?? 0}  (0 = no stranded credits)`);
  console.log(`  queue waiting (worker, post-run): ${after.queue_waiting ?? 'n/a'}`);
  console.log(`  api http requests served:         ${dApi('http_total')}`);
  console.log(`  api 5xx during run:               ${dApi('http_5xx')}`);

  // 4. TEARDOWN — remove the pool's deliveries, ledger, and users.
  const ids = await db.query(
    `SELECT id FROM "users" WHERE email LIKE $1`,
    [`${EMAIL_PREFIX}%`],
  );
  const userIds = ids.rows.map((r) => r.id);
  if (userIds.length) {
    await db.query(`DELETE FROM "deliveries" WHERE "userId" = ANY($1)`, [userIds]);
    await db.query(`DELETE FROM "wallet_transactions" WHERE "userId" = ANY($1)`, [userIds]);
    await db.query(`DELETE FROM "outbox_events" WHERE "aggregateId" IN (SELECT id FROM "deliveries" WHERE "userId" = ANY($1))`, [userIds]).catch(() => {});
    await db.query(`DELETE FROM "users" WHERE id = ANY($1)`, [userIds]);
  }
  await db.end();
  console.log(`\ncleaned up ${userIds.length} pool users + their data.`);

  const failed = totalErr > totalReqs * 0.02 || dApi('http_5xx') > 0;
  console.log(failed ? '\nLOAD RUN: THRESHOLD BREACH' : '\nLOAD RUN: CLEAN (errors < 2%, 0 5xx)');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('DRIVER ERROR:', e?.stack ?? e);
  process.exit(2);
});
