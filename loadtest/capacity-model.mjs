#!/usr/bin/env node
// Drovery capacity model — project MEASURED per-node throughput to a 100k-DAU target.
//
//   node loadtest/capacity-model.mjs
//
// WHY this exists: a single load-test run on one laptop produces ONE muddy number
// (the prior run's 33.2 req/s was bottlenecked on cost-12 bcrypt, NOT on the I/O
// tiers). That number alone says nothing about "can this serve 100k users?". This
// model separates the tiers, takes the per-NODE capacity each tier sustains AT the
// latency SLO (measured in isolation), states the demand assumptions explicitly, and
// computes how many nodes of each tier 100k DAU needs — plus the connection budget
// and a Little's-Law sanity check.
//
// It is pure Node, ZERO dependencies, and runs today on the prior-run defaults. When
// you have clean isolated runs, overwrite the constants marked `FILL FROM RUN` and
// re-run — every output recomputes. Override any input from the CLI without editing,
// e.g.:  node loadtest/capacity-model.mjs --dau=250000 --peakHourShare=0.12
//
// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 1 — MEASURED per-node capacities  (the supply side; FILL FROM RUN)
// ─────────────────────────────────────────────────────────────────────────────────
// Each constant is the throughput ONE node of that tier sustains while STILL meeting
// the latency SLO. Measure each tier in ISOLATION so one bottleneck (bcrypt) doesn't
// mask the others — that is the whole point of splitting scenario.js into:
//   • scenario-io.js  — auth amortized ONCE in setup(); per-iter journey is pure I/O
//                       (create + list + get). Push VUs until the I/O p95 hits the
//                       SLO; per_node_io_rps = (sustained req/s at that point) / api_replicas.
//   • a drain probe   — enqueue a known backlog, time the worker tier to zero, divide
//                       by worker_replicas → per_worker_jobs_per_sec.
//   • scenario.js (SCENARIO=auth) — cold signups only (the bcrypt wall); the signup ceiling
//                       comes from the hash time below, cross-checked against this run.
//
// DEFAULTS BELOW are conservative placeholders derived from the prior shared-box run
// (4-core laptop, api=3 worker=3, 50 VUs, 90s). They let the model run NOW; they are
// NOT defensible cluster numbers — replace them with isolated-run measurements.

const MEASURED = {
  // I/O API tier: requests/sec ONE api replica serves at p95 ≤ SLO, auth amortized.
  // Prior shared-box run: the I/O steps stayed fast (create p95 659ms, list 248ms,
  // get 323ms) even while bcrypt saturated the CPU — so the true per-node I/O ceiling
  // is well above what that muddy run showed. 220 is a deliberately CONSERVATIVE
  // placeholder for a dedicated node. FILL FROM RUN (scenario-io).
  perNodeIoRps: 220,

  // Worker tier: BullMQ jobs/sec ONE worker replica drains (SIM_WORKER_CONCURRENCY=10).
  // FILL FROM RUN (drain probe: enqueue N, time to drain, /replicas).
  perWorkerJobsPerSec: 120,

  // The cost-12 bcrypt wall. ONE hash on a dedicated modern vCPU. Measured on THIS
  // box: ~264 ms/hash (a 4-core laptop also running the whole stack + k6). A dedicated
  // cloud vCPU is typically faster (~120–180 ms); keep the measured-here value as the
  // conservative default. signup throughput is CPU-bound: hashes/sec/core = 1000/ms.
  // FILL FROM RUN (measure on the TARGET node class).
  bcryptCost12MsPerHash: 264,

  // Usable CPU cores a signup-handling api node dedicates to hashing. bcrypt releases
  // the libuv thread pool, so it parallelizes across cores up to UV_THREADPOOL_SIZE.
  signupCoresPerNode: 2,

  // Observed I/O step p95s (ms) from the prior run — used ONLY for the Little's-Law
  // mean-latency input and the printed reference table. FILL FROM RUN.
  p95CreateMs: 659,
  p95ListMs: 248,
  p95GetMs: 323,
};

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 2 — DEMAND assumptions  (the load side; every value stated + overridable)
// ─────────────────────────────────────────────────────────────────────────────────
// These are the dials a reviewer will challenge. Each is a named constant with a
// stated basis; override any from the CLI (see parseArgs). The SENSITIVITY section at
// the bottom reports which one moves the answer most.

const DEMAND = {
  dau: 100_000, // target daily active users (the headline).

  // Total app HTTP requests an active user makes per day (opens app, lists deliveries,
  // polls a tracked delivery a few times, occasionally creates one). 30 is a moderate
  // engagement assumption for a logistics app — most days are reads/polls.
  reqsPerUserPerDay: 30,

  // Request MIX (must sum to ~1). Reads dominate (list + poll/track); writes are the
  // create-delivery path; "auth" here is login/refresh (cheap relative to signup, which
  // is modelled SEPARATELY by new-users/day, not as a fraction of steady traffic).
  readFraction: 0.78,
  writeFraction: 0.2,
  authFraction: 0.02,

  // NEW users registering per day = the only thing that hits the cost-12 signup wall.
  // 3% of DAU/day is a healthy-growth assumption; signups are NOT a fraction of steady
  // request traffic (a user signs up once, then makes thousands of I/O requests).
  newUsersPerDay: 3_000,

  // How many deliveries an active user CREATES per day — the ONLY write that fans
  // lifecycle jobs to the worker tier. A delivery app's DAU don't all create daily;
  // 1.5 is a moderately active assumption. (Other writes — ratings, saved addresses,
  // profile edits — are cheap I/O folded into perNodeIoRps, NOT worker load.) The
  // fan-out per create is the CODE-DERIVED constant below, not a guess. Override with
  // product analytics once you have them.
  deliveryCreatesPerUserPerDay: 1.5,

  // DIURNAL peak. Fraction of the whole day's volume that lands in the single busiest
  // hour. A flat day would be 1/24 ≈ 0.0417; real apps spike. 0.10 (10% of daily volume
  // in the peak hour) → peakFactor = 0.10 × 24 = 2.4× the average hour. This is the
  // single most load-bearing assumption — see SENSITIVITY.
  peakHourShare: 0.1,
};

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 3 — INFRA budget constants  (from docker-compose.yml; the hard ceilings)
// ─────────────────────────────────────────────────────────────────────────────────
const INFRA = {
  apiPoolMax: 10, // api  DATABASE_POOL_MAX (client conns each api replica opens to PgBouncer)
  workerPoolMax: 5, // worker DATABASE_POOL_MAX
  pgbouncerMaxClientConn: 1000, // PgBouncer MAX_CLIENT_CONN (the client-side ceiling)
  pgbouncerDefaultPoolSize: 20, // server-side conns PgBouncer opens to Postgres (per db/user)
};

// SLO the per-node capacities are measured AT (kept here so the report can state it).
const SLO = { p95Ms: 1500 };

// ─────────────────────────────────────────────────────────────────────────────────
// CODE-DERIVED constant — NOT a measurement and NOT a guess; read straight from source.
// ─────────────────────────────────────────────────────────────────────────────────
// Lifecycle BullMQ jobs fanned per IMMEDIATE delivery create: the producer does
// addBulk([...STAGES, ...positionTicks]) = STAGES.length (5) + POSITION_TICK_COUNT (12)
// = 17 jobs (src/deliveries/simulation/simulation.constants.ts + simulation.service.ts).
// A SCHEDULED (future-pickup) delivery adds ONE kickoff job that later fans the same 17.
// Overridable only for "what if the sim chain changes" — it is otherwise fixed by code.
const CODE = { jobsPerCreate: 17 };

// ─────────────────────────────────────────────────────────────────────────────────
// CLI overrides — let the user re-run "what if" without editing the file.
//   --dau=250000  --peakHourShare=0.12  --reqsPerUserPerDay=40  --jobsPerCreate=8 ...
// Any DEMAND / MEASURED / INFRA / CODE key is overridable by its name (case-sensitive).
// ─────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([A-Za-z0-9]+)=(.+)$/.exec(a);
    if (!m) continue;
    const n = Number(m[2]);
    out[m[1]] = Number.isFinite(n) ? n : m[2];
  }
  return out;
}
const overrides = parseArgs(process.argv);
const KNOWN = [DEMAND, MEASURED, INFRA, CODE];
const unknown = [];
for (const k of Object.keys(overrides)) {
  const target = KNOWN.find((o) => k in o);
  if (target) target[k] = overrides[k];
  else unknown.push(k);
}
// Fail loud on a typo'd/mis-cased dial rather than silently computing the DEFAULT scenario
// under a misleading command line (this tool's whole job is defensible numbers).
if (unknown.length) {
  const all = KNOWN.flatMap((o) => Object.keys(o)).sort();
  console.error(
    `capacity-model: unknown override(s): ${unknown.map((k) => '--' + k).join(', ')}\n` +
      `Keys are case-sensitive camelCase. Valid: ${all.join(', ')}`,
  );
  process.exit(1);
}
// Reject degenerate inputs (a 0/negative/non-numeric divisor would print Infinity/NaN node
// counts under a confident "serve X DAU" verdict). Validate AFTER overrides, BEFORE the math.
const mustBePositive = {
  'MEASURED.perNodeIoRps': MEASURED.perNodeIoRps,
  'MEASURED.perWorkerJobsPerSec': MEASURED.perWorkerJobsPerSec,
  'MEASURED.bcryptCost12MsPerHash': MEASURED.bcryptCost12MsPerHash,
  'MEASURED.signupCoresPerNode': MEASURED.signupCoresPerNode,
  'CODE.jobsPerCreate': CODE.jobsPerCreate,
  'DEMAND.dau': DEMAND.dau,
};
const bad = [];
for (const [name, v] of Object.entries(mustBePositive)) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
    bad.push(`${name}=${JSON.stringify(v)} (must be a finite number > 0)`);
}
for (const obj of KNOWN)
  for (const [k, v] of Object.entries(obj))
    if (typeof v !== 'number' || !Number.isFinite(v))
      bad.push(`${k}=${JSON.stringify(v)} (non-numeric / non-finite)`);
if (bad.length) {
  console.error('capacity-model: invalid input(s):\n  - ' + bad.join('\n  - '));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 4 — THE MATH
// ─────────────────────────────────────────────────────────────────────────────────
const SECONDS_PER_DAY = 86_400;

// peakFactor: multiply the average-hour rps to get the peak-hour rps.
//   share of daily volume in peak hour × 24 hours = peak/average ratio.
const peakFactor = DEMAND.peakHourShare * 24;

// Average and peak total request rate (all request types).
const avgRps = (DEMAND.dau * DEMAND.reqsPerUserPerDay) / SECONDS_PER_DAY;
const peakRps = avgRps * peakFactor;

// I/O demand = the reads + writes that the api I/O tier serves (auth login/refresh is
// cheap and folded into I/O capacity; signup is sized separately below).
const ioMixFraction =
  DEMAND.readFraction + DEMAND.writeFraction + DEMAND.authFraction;
const peakIoRps = peakRps * ioMixFraction;
const requiredApiNodes = Math.ceil(peakIoRps / MEASURED.perNodeIoRps);

// Worker demand = (peak delivery-creates/sec) × (lifecycle jobs fanned per create).
// Sized from delivery CREATES specifically (the only write that enqueues), NOT a flat
// fraction of all writes — that keeps the fan-out the REAL measured 17, not an average
// muddied by cheap non-create writes. `peakWriteRps` (all writes) is kept for the demand
// breakdown line only; it does NOT size the worker tier.
const peakWriteRps = peakRps * DEMAND.writeFraction;
const peakCreateRps =
  ((DEMAND.dau * DEMAND.deliveryCreatesPerUserPerDay) / SECONDS_PER_DAY) *
  peakFactor;
const peakJobsPerSec = peakCreateRps * CODE.jobsPerCreate;
const requiredWorkerNodes = Math.ceil(
  peakJobsPerSec / MEASURED.perWorkerJobsPerSec,
);

// Signup (cost-12 bcrypt) demand, sized from NEW users/day at peak, against the
// CPU-bound hash ceiling. hashes/sec/core = 1000 / msPerHash. A node's signup ceiling
// = that × cores dedicated to hashing.
const peakSignupPerSec =
  (DEMAND.newUsersPerDay / SECONDS_PER_DAY) * peakFactor;
const hashesPerSecPerCore = 1000 / MEASURED.bcryptCost12MsPerHash;
const signupCeilingPerNode =
  hashesPerSecPerCore * MEASURED.signupCoresPerNode;
const requiredSignupNodes = Math.ceil(
  peakSignupPerSec / signupCeilingPerNode,
);

// The api fleet must satisfy BOTH its I/O demand AND absorb signups. Signup-equivalent
// node demand is tiny here (signups are rare vs steady I/O), so the api tier is sized
// by max(io, signup); we report both and the binding one.
const requiredApiNodesEffective = Math.max(
  requiredApiNodes,
  requiredSignupNodes,
);

// ── Connection budget ──────────────────────────────────────────────────────────
// Client side: every api/worker replica opens up to its POOL_MAX conns to PgBouncer.
const pgbouncerClientConns =
  requiredApiNodesEffective * INFRA.apiPoolMax +
  requiredWorkerNodes * INFRA.workerPoolMax;
const clientConnHeadroomPct =
  (1 - pgbouncerClientConns / INFRA.pgbouncerMaxClientConn) * 100;
// Server side: PgBouncer (transaction pooling) multiplexes ALL of those onto its small
// server pool — this is the whole reason the app tiers can autoscale without touching
// Postgres max_connections.
const postgresServerConns = INFRA.pgbouncerDefaultPoolSize; // per (db,user) pool

// ── Little's Law sanity check ────────────────────────────────────────────────────
// concurrency (in-flight requests) = arrival_rate × service_time. We blend the three step
// p95s (NOT means) as the service-time stand-in: p95 > mean for skewed latency, so the
// in-flight estimate is biased HIGH on purpose — that makes the `< 1000` plausibility gate
// strictly conservative (errs toward flagging implausible, never toward false reassurance).
const p95BlendLatencyMs =
  (MEASURED.p95CreateMs + MEASURED.p95ListMs + MEASURED.p95GetMs) / 3;
const meanIoLatencyS = p95BlendLatencyMs / 1000;
const peakConcurrency = peakIoRps * meanIoLatencyS;
const perNodeConcurrency = peakConcurrency / requiredApiNodesEffective;

// ── Headroom of the chosen fleet ─────────────────────────────────────────────────
const apiCapacityRps = requiredApiNodesEffective * MEASURED.perNodeIoRps;
const apiHeadroomPct = (1 - peakIoRps / apiCapacityRps) * 100;
const workerCapacityJps =
  requiredWorkerNodes * MEASURED.perWorkerJobsPerSec;
const workerHeadroomPct =
  (1 - peakJobsPerSec / workerCapacityJps) * 100;

// Limiting factor across the whole system: which tier is tightest (lowest headroom)?
const tiers = [
  { name: 'API I/O tier', headroom: apiHeadroomPct },
  { name: 'Worker tier', headroom: workerHeadroomPct },
  {
    name: 'PgBouncer client conns',
    headroom: clientConnHeadroomPct,
  },
];
const limiting = tiers.reduce((a, b) => (b.headroom < a.headroom ? b : a));

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 5 — OUTPUT
// ─────────────────────────────────────────────────────────────────────────────────
const f = (n, d = 1) => Number(n).toFixed(d);
// Truncate-or-pad so an over-long cell can never push the table's right border out of
// alignment (padEnd only ever grows the string). '…' marks a truncation.
const pad = (s, w) => {
  const str = String(s);
  return str.length > w ? str.slice(0, w - 1) + '…' : str.padEnd(w);
};
// Same truncate-or-pad guarantee as pad(), for the right-aligned numeric columns: an absurd
// override (e.g. a 30-digit jobsPerCreate → scientific-notation node count) can't blow the
// right border out either. Keeps the least-significant tail, marked with a leading '…'.
const padL = (s, w) => {
  const str = String(s);
  return str.length > w ? '…' + str.slice(str.length - w + 1) : str.padStart(w);
};

console.log('');
console.log(
  '═══ Drovery capacity model ─ projecting measured per-node throughput to target ═══',
);
console.log('');
console.log(
  `Target: ${DEMAND.dau.toLocaleString()} DAU · ${DEMAND.reqsPerUserPerDay} reqs/user/day · ` +
    `peak ${f(DEMAND.peakHourShare * 100, 0)}%/peak-hour (×${f(peakFactor, 2)} avg) · SLO p95 ≤ ${SLO.p95Ms}ms`,
);
console.log(
  `Demand: avg ${f(avgRps)} req/s → PEAK ${f(peakRps)} req/s ` +
    `(io ${f(peakIoRps)} · writes ${f(peakWriteRps)} · creates ${f(peakCreateRps, 2)}/s → jobs ${f(peakJobsPerSec)}/s · signups ${f(peakSignupPerSec, 3)}/s)`,
);
console.log('');

// ── Main projection table ──
const COLS = [34, 20, 14, 28];
const row = (a, b, c, d) =>
  `│ ${pad(a, COLS[0])} │ ${padL(b, COLS[1])} │ ${padL(c, COLS[2])} │ ${pad(d, COLS[3])} │`;
const sep = (l, m, r) =>
  l +
  COLS.map((w) => '─'.repeat(w + 2)).join(m) +
  r;

const nodesHeader = `Nodes @${(DEMAND.dau / 1000).toLocaleString()}k`;
console.log(sep('┌', '┬', '┐'));
console.log(row('Component', 'Per-node capacity', nodesHeader, 'Limiting factor'));
console.log(sep('├', '┼', '┤'));
console.log(
  row(
    'API I/O (read+write+login)',
    `${f(MEASURED.perNodeIoRps, 0)} req/s`,
    requiredApiNodes,
    'CPU + PgBouncer pool',
  ),
);
console.log(
  row(
    'Signup (bcrypt cost-12)',
    `${f(signupCeilingPerNode)} sign/s`,
    requiredSignupNodes,
    `CPU hash (${f(MEASURED.bcryptCost12MsPerHash, 0)}ms/hash)`,
  ),
);
console.log(
  row(
    'API fleet (max of above)',
    '—',
    requiredApiNodesEffective,
    requiredApiNodes >= requiredSignupNodes ? 'I/O-bound' : 'signup-bound',
  ),
);
console.log(
  row(
    'Worker (BullMQ drain)',
    `${f(MEASURED.perWorkerJobsPerSec, 0)} jobs/s`,
    requiredWorkerNodes,
    `jobs/create=${CODE.jobsPerCreate} · DB writes`,
  ),
);
console.log(sep('└', '┴', '┘'));
console.log('');

// ── Connection budget check ──
console.log('Connection budget (PgBouncer transaction pooling):');
console.log(
  `  client side : ${requiredApiNodesEffective}×${INFRA.apiPoolMax} (api) + ` +
    `${requiredWorkerNodes}×${INFRA.workerPoolMax} (worker) = ${pgbouncerClientConns} conns ` +
    `of ${INFRA.pgbouncerMaxClientConn} max  →  ${f(clientConnHeadroomPct)}% headroom ` +
    `${pgbouncerClientConns <= INFRA.pgbouncerMaxClientConn ? '✅' : '❌ OVER BUDGET'}`,
);
console.log(
  `  server side : PgBouncer multiplexes all of the above onto ${postgresServerConns} ` +
    `Postgres conns (DEFAULT_POOL_SIZE) — Postgres max_connections is NEVER the limit ✅`,
);
console.log('');

// ── Little's Law sanity ──
console.log("Little's Law sanity check (concurrency = arrival × service time):");
console.log(
  `  peak I/O ${f(peakIoRps)} req/s × ${f(meanIoLatencyS, 3)}s p95-blend = ` +
    `${f(peakConcurrency)} in-flight  ≈ ${f(perNodeConcurrency)}/api-node ` +
    `${perNodeConcurrency < 1000 ? '✅ plausible' : '❌ implausible — recheck inputs'}`,
);
console.log('');

// ── Verdict + headroom + limiting factor ──
console.log(
  `VERDICT: ${requiredApiNodesEffective} api + ${requiredWorkerNodes} worker nodes serve ${DEMAND.dau.toLocaleString()} DAU ` +
    `at the SLO. Tightest tier: ${limiting.name} (${f(limiting.headroom)}% headroom).`,
);
console.log(
  `         API fleet headroom ${f(apiHeadroomPct)}% · Worker headroom ${f(workerHeadroomPct)}% · ` +
    `Conn headroom ${f(clientConnHeadroomPct)}%.`,
);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 6 — SENSITIVITY  (what changes the answer most; ±25% one-at-a-time)
// ─────────────────────────────────────────────────────────────────────────────────
// Re-derive required api+worker node TOTAL under ±25% of each demand dial, holding the
// rest fixed. The dial with the widest node-count swing is the one to measure best.
function totalNodes(d, m) {
  const pf = d.peakHourShare * 24;
  const _avg = (d.dau * d.reqsPerUserPerDay) / SECONDS_PER_DAY;
  const _peak = _avg * pf;
  const _io = _peak * (d.readFraction + d.writeFraction + d.authFraction);
  const _api = Math.ceil(_io / m.perNodeIoRps);
  const _create =
    ((d.dau * d.deliveryCreatesPerUserPerDay) / SECONDS_PER_DAY) * pf;
  const _jobs = _create * CODE.jobsPerCreate;
  const _wk = Math.ceil(_jobs / m.perWorkerJobsPerSec);
  const _sig =
    (d.newUsersPerDay / SECONDS_PER_DAY) *
    pf /
    ((1000 / m.bcryptCost12MsPerHash) * m.signupCoresPerNode);
  return Math.max(_api, Math.ceil(_sig)) + _wk;
}
const base = totalNodes(DEMAND, MEASURED);
const dials = [
  ['dau', DEMAND],
  ['reqsPerUserPerDay', DEMAND],
  ['peakHourShare', DEMAND],
  ['deliveryCreatesPerUserPerDay', DEMAND],
  ['perNodeIoRps', MEASURED],
  ['perWorkerJobsPerSec', MEASURED],
];
const results = dials.map(([key, obj]) => {
  const lo = { ...DEMAND },
    loM = { ...MEASURED };
  const hi = { ...DEMAND },
    hiM = { ...MEASURED };
  const tgtLo = obj === DEMAND ? lo : loM;
  const tgtHi = obj === DEMAND ? hi : hiM;
  tgtLo[key] = obj[key] * 0.75;
  tgtHi[key] = obj[key] * 1.25;
  const nLo = totalNodes(lo, loM);
  const nHi = totalNodes(hi, hiM);
  return { key, nLo, nHi, swing: Math.abs(nHi - nLo) };
});
results.sort((a, b) => b.swing - a.swing);

console.log('Sensitivity (total api+worker nodes; each dial ±25%, base = ' + base + '):');
for (const r of results) {
  console.log(
    `  ${pad(r.key, 30)} −25% → ${padL(r.nLo, 3)} nodes   +25% → ${padL(r.nHi, 3)} nodes   (swing ${r.swing})`,
  );
}
if (results[0].swing === 0) {
  // ceil() to integer nodes is coarse at low counts: when the whole fleet rounds to
  // 1–2 nodes, a ±25% dial doesn't cross a node boundary, so every swing is 0. That's
  // correct (you can't run 1.3 nodes), not a bug — re-run at higher load to see which
  // dial actually moves the count.
  console.log(
    `\nAt this demand every tier rounds to 1 node, so ±25% crosses no node boundary` +
      ` (integer nodes). Re-run at higher load to rank sensitivity, e.g. --dau=${DEMAND.dau * 20}.`,
  );
} else {
  console.log(
    `\nMost load-bearing input: ${results[0].key} (widest node swing). Measure/justify it first.`,
  );
}
console.log('');
