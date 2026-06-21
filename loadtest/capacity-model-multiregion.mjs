#!/usr/bin/env node
// Drovery MULTI-REGION capacity model — extends capacity-model.mjs with the
// geo-distribution ceilings the single-region model does NOT cover.
//
//   node loadtest/capacity-model-multiregion.mjs
//   node loadtest/capacity-model-multiregion.mjs --dau=5000000 --regions=4
//
// WHY this exists: capacity-model.mjs sizes ONE region's api/worker/PgBouncer
// fleet and is honest that it does NOT model (a) the DB-PRIMARY WRITE ceiling,
// (b) Redis pub/sub fan-out, (c) concurrent-WS sockets, (d) anything cross-region.
// At >1M users spread across regions, the binding constraints move to:
//
//   1. PER-REGION Postgres-PRIMARY WRITE throughput. Every position tick + every
//      telemetry CAS funnels through TrackingService.updateTracking() -> ONE
//      upsert on ONE primary (src/deliveries/tracking/tracking.service.ts L46).
//      createdAt-partitioning helps storage/vacuum, NOT write rate. Sharding the
//      primary BY REGION (region-local active-active) is the only thing that
//      raises aggregate write throughput. This model computes per-region write
//      rps vs a measured per-primary write ceiling and tells you when a region
//      must split.
//   2. The REDIS-PUBSUB fan-out msgs/sec on the region's pub/sub backend
//      (single-Redis pub/sub does NOT shard in Cluster). Telemetry-rate bound.
//   3. CONCURRENT WS SOCKETS per api replica (FD/event-loop bound) — caps trackers
//      per region, and drives the WS-aware-replica count.
//   4. CROSS-REGION replication RPO: async replication of the GLOBAL tier (auth/
//      identity/billing) lag vs the data-loss budget on a region failover.
//   5. EDGE/CDN read offload: the fraction of reads served at the edge (cacheable
//      GETs: serviceability, geocode, public tracking polls) NEVER reaches a
//      region's api/db — it shrinks requiredApiNodes and primary read load.
//
// Pure Node, ZERO deps. Every input is a named constant overridable from the CLI
// (--key=value). Defaults are conservative laptop-derived placeholders + the
// repo's code-derived constants (jobsPerCreate=17, POSITION_TICK_COUNT=12).
// ─────────────────────────────────────────────────────────────────────────────

// SECTION 1 — MEASURED per-node / per-primary capacities (FILL FROM RUN)
const MEASURED = {
  perNodeIoRps: 220, // api I/O rps at SLO (from capacity-model.mjs)
  perWorkerJobsPerSec: 120, // BullMQ drain rps/worker

  // NEW 1M+ ceilings — measure these in isolation on the TARGET node class:

  // Sustained WRITE transactions/sec ONE Postgres primary holds at the write-path
  // p95 SLO, with the real index/partition overhead. The hot write is the
  // deliveryTracking upsert (one row/delivery, in place). 6000 is a deliberately
  // CONSERVATIVE placeholder for a single well-provisioned primary doing small
  // single-row upserts behind PgBouncer; a fsync-bound commit and the composite-FK
  // partition lookup pull it down. FILL FROM RUN (pgbench-style write probe on the
  // updateTracking path). THIS is the ceiling capacity-model.mjs omits.
  perPrimaryWriteTps: 6000,

  // Redis pub/sub messages/sec ONE pub/sub Redis sustains as PUBLISH egress
  // (msgs × subscribing-replicas). Single-node, does NOT shard in Cluster.
  // FILL FROM RUN (redis-benchmark PUBLISH + N subscribers).
  perPubsubRedisMsgsPerSec: 100_000,

  // Concurrent WS sockets ONE api replica holds at the event-loop SLO (raw-ws
  // gateway subscriptions Map; FD + heap + fan-out CPU bound). 20k is a moderate
  // Node ws figure; tune to the node class + payload size. FILL FROM RUN.
  perReplicaWsSockets: 20_000,
};

// SECTION 2 — DEMAND (the load side; stated + overridable)
const DEMAND = {
  dau: 2_000_000, // global DAU target (the headline for 1M+)
  regions: 3, // active-active region count (region = shard boundary)

  // Skew: fraction of global DAU in the BUSIEST region (regions are uneven —
  // Greater Jakarta dwarfs other hubs). The binding region is the busiest one,
  // so we size every region tier to the HOTTEST region, not the average.
  hottestRegionShare: 0.5,

  reqsPerUserPerDay: 30,
  readFraction: 0.78,
  writeFraction: 0.2,
  authFraction: 0.02,
  deliveryCreatesPerUserPerDay: 1.5,
  peakHourShare: 0.1,

  // Fraction of READS that are EDGE-CACHEABLE (public/owner-agnostic or short-TTL):
  // serviceability checks, geocode lookups, static config, anonymous tracking-page
  // polls. These terminate at the CDN/edge and never hit a region api/db. 0.35 =
  // a third of reads offloaded. The realtime WS tracking stream is NOT counted here
  // (it's a socket, not a cacheable GET).
  edgeCacheableReadFraction: 0.35,

  // Concurrent trackers: fraction of peak-hour active users holding an OPEN WS
  // tracking socket simultaneously (watching a live delivery). Drives WS-socket and
  // pub/sub load. 0.15 = 15% of the peak-hour cohort actively tracking.
  concurrentTrackerShare: 0.15,

  // GLOBAL-tier write rps share: auth/identity/billing writes (signup, login token
  // rotation, payment) that go to the ONE global primary (NOT region-local). Small
  // vs delivery writes but cross-region-replicated → the RPO concern.
  globalWriteFractionOfWrites: 0.08,
};

// SECTION 3 — INFRA / cross-region budget constants
const INFRA = {
  apiPoolMax: 10,
  workerPoolMax: 5,
  pgbouncerMaxClientConn: 1000,

  // Cross-region async replication lag (ms) of the GLOBAL primary to a standby in
  // another region — the data at risk on an unplanned global-primary failover.
  crossRegionReplLagMs: 800,
  // RPO budget (ms): max acceptable data loss on global failover. If repl lag >
  // RPO, you need synchronous/quorum commit (latency cost) or a tighter region.
  rpoBudgetMs: 1000,
};

// CODE-DERIVED (read from source; not guesses)
const CODE = {
  jobsPerCreate: 17, // STAGES(5)+POSITION_TICK_COUNT(12) — simulation.constants.ts
  positionTicksPerCreate: 12, // POSITION_TICK_COUNT — the hot write multiplier
  stageWritesPerCreate: 5, // status CAS writes per lifecycle
};

// ── CLI overrides ────────────────────────────────────────────────────────────
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
const KNOWN = [DEMAND, MEASURED, INFRA, CODE];
const unknown = [];
for (const [k, v] of Object.entries(parseArgs(process.argv))) {
  const t = KNOWN.find((o) => k in o);
  if (t) t[k] = v;
  else unknown.push(k);
}
if (unknown.length) {
  const all = KNOWN.flatMap((o) => Object.keys(o)).sort();
  console.error(
    `unknown override(s): ${unknown.map((k) => '--' + k).join(', ')}\n` +
      `Valid: ${all.join(', ')}`,
  );
  process.exit(1);
}
for (const obj of KNOWN)
  for (const [k, v] of Object.entries(obj))
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      console.error(`invalid ${k}=${JSON.stringify(v)} (must be finite > 0)`);
      process.exit(1);
    }
if (DEMAND.hottestRegionShare > 1 || DEMAND.hottestRegionShare < 1 / DEMAND.regions) {
  console.error(
    `hottestRegionShare must be in [1/regions, 1] (a region can't hold <even-split or >all)`,
  );
  process.exit(1);
}

// SECTION 4 — THE MATH
const SECONDS_PER_DAY = 86_400;
const f = (n, d = 1) => Number(n).toFixed(d);
const peakFactor = DEMAND.peakHourShare * 24;

// Hottest region's DAU — every region tier is sized to THIS (worst-case region).
const hotDau = DEMAND.dau * DEMAND.hottestRegionShare;

// Region-local request demand (peak).
const avgRps = (hotDau * DEMAND.reqsPerUserPerDay) / SECONDS_PER_DAY;
const peakRps = avgRps * peakFactor;
const peakReadRps = peakRps * DEMAND.readFraction;
const peakWriteRps = peakRps * DEMAND.writeFraction;

// EDGE OFFLOAD: cacheable reads never reach the region. Origin reads = the rest.
const edgeOffloadedRps = peakReadRps * DEMAND.edgeCacheableReadFraction;
const originReadRps = peakReadRps - edgeOffloadedRps;
const peakOriginIoRps =
  originReadRps + peakWriteRps + peakRps * DEMAND.authFraction;
const requiredApiNodes = Math.ceil(peakOriginIoRps / MEASURED.perNodeIoRps);
// What the api tier WOULD need WITHOUT the edge (to quantify the edge's value).
const peakIoNoEdge =
  peakReadRps + peakWriteRps + peakRps * DEMAND.authFraction;
const apiNodesNoEdge = Math.ceil(peakIoNoEdge / MEASURED.perNodeIoRps);

// ── PER-REGION DB-PRIMARY WRITE ceiling (the headline new constraint) ──────────
// Region-local writes/sec = lifecycle writes from creates + steady non-create
// writes. The hot path is position ticks (12/create) + stage CAS (5/create), each
// a primary write. Steady writes (the writeFraction traffic minus creates) add on.
const peakCreateRps =
  ((hotDau * DEMAND.deliveryCreatesPerUserPerDay) / SECONDS_PER_DAY) *
  peakFactor;
const lifecycleWritesPerSec =
  peakCreateRps * (CODE.positionTicksPerCreate + CODE.stageWritesPerCreate);
// Non-lifecycle region-local writes (ratings, addresses, profile) — the write
// traffic that ISN'T a delivery create. Bounded below by 0.
const otherWriteRps = Math.max(0, peakWriteRps - peakCreateRps);
const regionLocalWriteTps = lifecycleWritesPerSec + otherWriteRps;
const primariesNeededInHotRegion = Math.ceil(
  regionLocalWriteTps / MEASURED.perPrimaryWriteTps,
);
const primaryWriteHeadroomPct =
  (1 - regionLocalWriteTps / (primariesNeededInHotRegion * MEASURED.perPrimaryWriteTps)) *
  100;

// ── REDIS PUB/SUB fan-out in the hot region ────────────────────────────────────
// Publishes/sec ~= position ticks/sec + telemetry frames/sec (one publish each).
// Fan-out egress = publishes × subscribing api replicas (every replica with a
// local socket for that delivery gets the msg). Conservative: assume each publish
// is seen by `requiredApiNodes` replicas (worst case: hot deliveries spread).
const publishesPerSec = lifecycleWritesPerSec; // ticks + stages each publish
const pubsubEgressMsgsPerSec = publishesPerSec * requiredApiNodes;
const pubsubInstancesNeeded = Math.ceil(
  pubsubEgressMsgsPerSec / MEASURED.perPubsubRedisMsgsPerSec,
);
const pubsubHeadroomPct =
  (1 - pubsubEgressMsgsPerSec / (pubsubInstancesNeeded * MEASURED.perPubsubRedisMsgsPerSec)) *
  100;

// ── CONCURRENT WS SOCKETS in the hot region ────────────────────────────────────
const peakHourActive = hotDau * DEMAND.peakHourShare;
const concurrentTrackers = peakHourActive * DEMAND.concurrentTrackerShare;
const wsReplicasNeeded = Math.ceil(
  concurrentTrackers / MEASURED.perReplicaWsSockets,
);
// The api tier must satisfy BOTH I/O rps AND WS-socket capacity.
const apiNodesEffective = Math.max(requiredApiNodes, wsReplicasNeeded);

// ── Worker tier (region-local) ─────────────────────────────────────────────────
const peakJobsPerSec = peakCreateRps * CODE.jobsPerCreate;
const requiredWorkerNodes = Math.ceil(
  peakJobsPerSec / MEASURED.perWorkerJobsPerSec,
);

// ── GLOBAL tier + cross-region RPO ─────────────────────────────────────────────
// Global writes (auth/billing) aggregate ACROSS regions onto the one global
// primary. Sum every region's global-write share (use global DAU, not hot).
const globalAvgRps = (DEMAND.dau * DEMAND.reqsPerUserPerDay) / SECONDS_PER_DAY;
const globalPeakWriteRps = globalAvgRps * peakFactor * DEMAND.writeFraction;
const globalPrimaryWriteTps =
  globalPeakWriteRps * DEMAND.globalWriteFractionOfWrites;
const globalPrimariesNeeded = Math.ceil(
  globalPrimaryWriteTps / MEASURED.perPrimaryWriteTps,
);
const rpoOk = INFRA.crossRegionReplLagMs <= INFRA.rpoBudgetMs;
const dataAtRiskWrites =
  globalPrimaryWriteTps * (INFRA.crossRegionReplLagMs / 1000);

// ── PgBouncer budget (per region) ──────────────────────────────────────────────
const pgClientConns =
  apiNodesEffective * INFRA.apiPoolMax + requiredWorkerNodes * INFRA.workerPoolMax;
const connHeadroomPct = (1 - pgClientConns / INFRA.pgbouncerMaxClientConn) * 100;
// With a sharded primary, EACH shard primary needs its own PgBouncer; the 1000
// ceiling is now per-shard, multiplying the per-region conn budget.
const pgbouncersInHotRegion = primariesNeededInHotRegion;

// SECTION 5 — OUTPUT
console.log('');
console.log('═══ Drovery MULTI-REGION capacity model — geo-distribution ceilings ═══');
console.log('');
console.log(
  `Global: ${DEMAND.dau.toLocaleString()} DAU across ${DEMAND.regions} active-active region(s) · ` +
    `hottest region = ${f(DEMAND.hottestRegionShare * 100, 0)}% (${hotDau.toLocaleString()} DAU) · ` +
    `peak ×${f(peakFactor, 2)} · edge offloads ${f(DEMAND.edgeCacheableReadFraction * 100, 0)}% of reads`,
);
console.log('');
console.log('── HOTTEST REGION (every region tier is sized to this worst case) ──');
console.log(
  `Region demand: peak ${f(peakRps)} req/s ` +
    `(reads ${f(peakReadRps)} → edge ${f(edgeOffloadedRps)} + origin ${f(originReadRps)} · writes ${f(peakWriteRps)})`,
);
console.log('');

const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const COLS = [38, 22, 12, 30];
const row = (a, b, c, d) =>
  `│ ${pad(a, COLS[0])} │ ${padL(b, COLS[1])} │ ${padL(c, COLS[2])} │ ${pad(d, COLS[3])} │`;
const sep = (l, m, r) =>
  l + COLS.map((w) => '─'.repeat(w + 2)).join(m) + r;

console.log(sep('┌', '┬', '┐'));
console.log(row('Tier (per hottest region)', 'Demand', 'Units', 'Ceiling / note'));
console.log(sep('├', '┼', '┤'));
console.log(
  row('API I/O (post-edge)', `${f(peakOriginIoRps)} rps`, requiredApiNodes,
    `${MEASURED.perNodeIoRps} rps/node`),
);
console.log(
  row('  └ if NO edge offload', `${f(peakIoNoEdge)} rps`, apiNodesNoEdge,
    `edge saves ${apiNodesNoEdge - requiredApiNodes} api node(s)`),
);
console.log(
  row('WS sockets (concurrent trackers)', `${f(concurrentTrackers, 0)} sock`, wsReplicasNeeded,
    `${MEASURED.perReplicaWsSockets}/replica`),
);
console.log(
  row('API fleet (max io, ws)', '—', apiNodesEffective,
    requiredApiNodes >= wsReplicasNeeded ? 'I/O-bound' : 'WS-socket-bound'),
);
console.log(
  row('Worker (BullMQ)', `${f(peakJobsPerSec)} job/s`, requiredWorkerNodes,
    `jobs/create=${CODE.jobsPerCreate}`),
);
console.log(sep('├', '┼', '┤'));
console.log(
  row('DB-PRIMARY WRITE  ★NEW★', `${f(regionLocalWriteTps)} tps`, primariesNeededInHotRegion,
    `${MEASURED.perPrimaryWriteTps} tps/primary`),
);
console.log(
  row('REDIS PUB/SUB egress ★NEW★', `${f(pubsubEgressMsgsPerSec, 0)} m/s`, pubsubInstancesNeeded,
    `${(MEASURED.perPubsubRedisMsgsPerSec / 1000).toFixed(0)}k m/s/inst`),
);
console.log(sep('└', '┴', '┘'));
console.log('');

console.log('── DB-PRIMARY WRITE breakdown (the ceiling capacity-model.mjs omits) ──');
console.log(
  `  creates ${f(peakCreateRps, 2)}/s × ${CODE.positionTicksPerCreate} pos + ` +
    `${CODE.stageWritesPerCreate} stage = ${f(lifecycleWritesPerSec)} lifecycle-writes/s` +
    ` + ${f(otherWriteRps)} other = ${f(regionLocalWriteTps)} write tps`,
);
console.log(
  `  → hottest region needs ${primariesNeededInHotRegion} write-shard primary(ies) ` +
    `(${f(primaryWriteHeadroomPct)}% headroom) ${primariesNeededInHotRegion > 1 ? '⇒ SHARD the region primary by sub-zone/hub' : '⇒ single primary OK'}`,
);
console.log(
  `  ⚠ partitioning does NOT relieve this — all writes still hit one primary per shard. ` +
    `The seam: TrackingService.updateTracking() → Redis-last-position + async checkpoint cuts ` +
    `position writes ~${CODE.positionTicksPerCreate}:1.`,
);
// What the offload buys:
const offloadedWriteTps =
  peakCreateRps * CODE.positionTicksPerCreate * 0.9; // 90% of pos ticks coalesced
const writeAfterOffload = regionLocalWriteTps - offloadedWriteTps;
const primariesAfterOffload = Math.ceil(
  Math.max(1, writeAfterOffload) / MEASURED.perPrimaryWriteTps,
);
console.log(
  `  WITH the Redis hot-store seam (coalesce 90% of position ticks): ` +
    `${f(writeAfterOffload)} write tps → ${primariesAfterOffload} primary(ies) ` +
    `(saves ${primariesNeededInHotRegion - primariesAfterOffload} shard(s) in the hot region).`,
);
console.log('');

console.log('── GLOBAL tier (auth/identity/billing — NOT region-local) + RPO ──');
console.log(
  `  global writes ${f(globalPrimaryWriteTps)} tps → ${globalPrimariesNeeded} global primary(ies) ` +
    `(${(DEMAND.globalWriteFractionOfWrites * 100).toFixed(0)}% of all writes, aggregated across regions)`,
);
console.log(
  `  cross-region repl lag ${INFRA.crossRegionReplLagMs}ms vs RPO budget ${INFRA.rpoBudgetMs}ms ` +
    `${rpoOk ? '✅ within RPO' : '❌ OVER RPO — need quorum/sync commit or tighter standby'}`,
);
console.log(
  `  data at risk on global-primary failover ≈ ${f(dataAtRiskWrites)} writes ` +
    `(repl-lag × global write tps) — auth/billing, so size the RPO to the billing tolerance.`,
);
console.log('');

console.log('── PgBouncer budget (now PER SHARD, per region) ──');
console.log(
  `  ${apiNodesEffective}×${INFRA.apiPoolMax} (api) + ${requiredWorkerNodes}×${INFRA.workerPoolMax} (worker) = ` +
    `${pgClientConns} conns of ${INFRA.pgbouncerMaxClientConn} ${pgClientConns <= INFRA.pgbouncerMaxClientConn ? '✅' : '❌ OVER — split shards'} ` +
    `(${f(connHeadroomPct)}% headroom) · ${pgbouncersInHotRegion} PgBouncer(s) in hot region`,
);
console.log('');

// ── VERDICT: the binding tier across the new ceilings ──
const ceilings = [
  { name: 'API fleet', n: apiNodesEffective },
  { name: 'Worker', n: requiredWorkerNodes },
  { name: 'DB-primary write-shards', n: primariesNeededInHotRegion, hard: true },
  { name: 'Pub/sub instances', n: pubsubInstancesNeeded, hard: true },
];
const hardSplit = ceilings.filter((c) => c.hard && c.n > 1);
console.log(
  `VERDICT (hottest region): ${apiNodesEffective} api + ${requiredWorkerNodes} worker + ` +
    `${primariesNeededInHotRegion} write-primary + ${pubsubInstancesNeeded} pubsub-instance. ` +
    `× ~${DEMAND.regions} regions (sized to share).`,
);
if (hardSplit.length) {
  console.log(
    `         ⇒ HARD STRUCTURAL CHANGE NEEDED: ${hardSplit
      .map((c) => `${c.name} > 1 (=${c.n})`)
      .join(', ')} — these don't autoscale by adding stateless nodes; they need ` +
      `sharding / a broker / sub-region split.`,
  );
} else {
  console.log(
    `         ⇒ single primary + single pub/sub per region still fits; scale stateless tiers only.`,
  );
}
console.log('');

// SECTION 6 — SENSITIVITY on the NEW dials
console.log('Sensitivity of DB-primary write-shards (the binding new ceiling):');
for (const [key, base] of [
  ['dau', DEMAND.dau],
  ['hottestRegionShare', DEMAND.hottestRegionShare],
  ['deliveryCreatesPerUserPerDay', DEMAND.deliveryCreatesPerUserPerDay],
  ['peakHourShare', DEMAND.peakHourShare],
  ['perPrimaryWriteTps', MEASURED.perPrimaryWriteTps],
]) {
  const calc = (mult) => {
    const D = { ...DEMAND }, M = { ...MEASURED };
    if (key in D) D[key] = base * mult;
    else M[key] = base * mult;
    const hd = D.dau * D.hottestRegionShare;
    const pf = D.peakHourShare * 24;
    const cr = ((hd * D.deliveryCreatesPerUserPerDay) / SECONDS_PER_DAY) * pf;
    const pw = ((hd * D.reqsPerUserPerDay) / SECONDS_PER_DAY) * pf * D.writeFraction;
    const wtps =
      cr * (CODE.positionTicksPerCreate + CODE.stageWritesPerCreate) +
      Math.max(0, pw - cr);
    return Math.ceil(wtps / M.perPrimaryWriteTps);
  };
  console.log(
    `  ${pad(key, 30)} −25% → ${padL(calc(0.75), 2)} shard(s)   +25% → ${padL(calc(1.25), 2)} shard(s)`,
  );
}
console.log('');
