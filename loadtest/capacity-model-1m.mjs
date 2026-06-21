#!/usr/bin/env node
// Drovery capacity model — 1M+ EXTENSION: the ceilings the base model omits.
//
//   node loadtest/capacity-model-1m.mjs --dau=2000000
//
// WHY this exists: loadtest/capacity-model.mjs sizes the api / signup / worker tiers
// and the PgBouncer CLIENT-conn budget. It is honest about what it models — and
// explicit that it does NOT model the four ceilings that actually bind FIRST past
// ~1M DAU, all of which are SINGLE-Redis / SINGLE-primary / SINGLE-pooler bound:
//
//   (1) DB-PRIMARY WRITE throughput   — every position tick + telemetry CAS is an
//       UPSERT on the ONE Postgres primary via TrackingService.updateTracking().
//       createdAt-partitioning helps storage/vacuum, NOT write rate.
//   (2) REDIS pub/sub fan-out         — TrackingPublisher.publishUpdate() PUBLISHes
//       every position frame to ONE Redis; pub/sub is O(subscribing connections) on
//       a single node and does NOT shard in Redis Cluster (it broadcasts).
//   (3) REDIS throttler INCR rate     — the @nestjs/throttler storage does INCR+TTL
//       on the SAME single Redis on EVERY request (highest-RPS Redis consumer).
//   (4) BullMQ queue ops              — enqueue+process+ack of 17 jobs/create plus
//       the delayed-set housekeeping, all on the SAME single Redis.
//
// This script projects MEASURED single-node ceilings for each NEW tier to the DAU
// target, reports headroom, and — crucially — tells you the SHARD COUNT each tier
// needs (how many Redis shards / DB write shards / PgBouncer poolers), and the
// re-derived PgBouncer client-conn budget PER SHARD once you fan the fleet across
// multiple poolers. Pure Node, zero deps. Every input is a named, overridable dial.
//
// Override any dial from the CLI, e.g.:
//   node loadtest/capacity-model-1m.mjs --dau=2000000 --liveFrameHz=1 \
//     --liveSharePct=20 --redisOpsCeil=120000 --pubsubMsgsCeil=300000

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 1 — MEASURED single-node ceilings  (the supply side; FILL FROM RUN)
// ─────────────────────────────────────────────────────────────────────────────────
const MEASURED = {
  // Postgres PRIMARY sustained write throughput: single-row UPSERTs/sec one primary
  // sustains at the latency SLO with realistic row width + indexes + WAL fsync. A
  // modest cloud primary (8 vCPU, fast NVMe/EBS) does low-tens-of-thousands of small
  // upserts/sec; 12000 is a deliberately CONSERVATIVE default for one tracking row.
  // This is THE un-modeled ceiling. FILL FROM RUN (pgbench -f tracking_upsert.sql).
  dbPrimaryUpsertsPerSec: 12_000,

  // Redis single-node total ops/sec (GET/SET/INCR) at sub-ms p99. A single modern
  // Redis core does ~100k+ simple ops/sec; 100000 is a safe planning number for a
  // shared instance also doing other work. FILL FROM RUN (redis-benchmark -t incr).
  redisOpsPerSecPerNode: 100_000,

  // Redis single-node PUB/SUB delivered-messages/sec ceiling. Pub/sub cost is
  // O(subscribers); the binding number is messages-DELIVERED/sec (publishes ×
  // avg-subscribing-connections), not publishes alone. 250000 deliveries/sec is a
  // conservative single-node ceiling. FILL FROM RUN (redis-benchmark pub/sub).
  pubsubDeliveriesPerSecPerNode: 250_000,

  // BullMQ queue ops/sec one Redis sustains for the queue role (enqueue + the
  // internal move/ack/complete ops). Each job touches Redis several times; 40000
  // queue-ops/sec/node is conservative. FILL FROM RUN (drain probe + redis MONITOR).
  bullmqOpsPerSecPerNode: 40_000,

  // Concurrent WebSocket sockets ONE api replica holds at steady event-loop load
  // (FD + heap + per-socket send cadence bound). 20000 is conservative for a Node
  // raw-ws gateway pushing a 5s cadence. FILL FROM RUN (ws soak test).
  wsSocketsPerApiReplica: 20_000,
};

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 2 — DEMAND assumptions  (mirror capacity-model.mjs; same dials + 3 new)
// ─────────────────────────────────────────────────────────────────────────────────
const DEMAND = {
  dau: 2_000_000,
  reqsPerUserPerDay: 30,
  deliveryCreatesPerUserPerDay: 1.5,
  peakHourShare: 0.1, // → peakFactor 2.4× the average hour

  // Position frames PER delivery the worker emits over its flight (sim path):
  // POSITION_TICK_COUNT in simulation.constants.ts. Each = 1 DB upsert + 1 publish.
  positionTicksPerDelivery: 12,

  // Fraction of in-flight deliveries flown by a LIVE drone streaming telemetry at
  // liveFrameHz (vs the 12-tick sim). LIVE frames arrive far faster than the 5s sim
  // tick, so even a small live share dominates the write/publish rate. Default 0 =
  // pure-sim baseline; set --liveSharePct=20 --liveFrameHz=1 for a live-fleet mix.
  liveSharePct: 0,
  liveFrameHz: 1, // frames/sec a LIVE drone streams while moving
  liveFlightMinutes: 8, // minutes a live drone is actively streaming per delivery

  // Concurrent trackers: fraction of in-flight deliveries that have a live WS
  // tracker attached (the app open on the recipient's phone). Drives WS socket
  // count and pub/sub fan-out width.
  trackedFraction: 0.6,

  // Avg number of api replicas subscribed to a given delivery's channel = how many
  // replicas hold at least one socket for it. With sticky WS routing this is ~1;
  // without stickiness it trends toward the replica count. 1.0 = ideal sticky LB.
  avgSubscribingReplicasPerDelivery: 1.0,

  // Throttler does this many Redis INCR-class ops per inbound HTTP request (INCR +
  // PEXPIRE on first hit ≈ 1–2). 1 request → ~1 throttle op against the throttle Redis.
  throttleOpsPerRequest: 1,

  // ── ASSUMPTION dials — NOT code-derived (unlike positionTicksPerDelivery=12);
  //    named so a reader can't mistake them for measured constants. ──
  // WS socket-hold time per tracked delivery. The sim reaches AWAITING_HANDOFF at
  // ~120s, but a recipient can leave the app open an UNBOUNDED time, so the true
  // tail is longer and unmeasured. The REAL number is the realtime-tier KEDA gauge
  // drovery_ws_open_sockets; this only sizes a planning estimate. --socketHoldSeconds
  socketHoldSeconds: 180,
  // Notification rows written per delivery ≈ the 5 status transitions that notify.
  // Each NotificationsService.create() is a PRIMARY write (+ an Expo push fan-out) —
  // a real DB-write contributor the base model omits. --notifyWritesPerDelivery
  notifyWritesPerDelivery: 5,
};

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 3 — INFRA budget constants
// ─────────────────────────────────────────────────────────────────────────────────
const INFRA = {
  apiPoolMax: 10,
  workerPoolMax: 5,
  pgbouncerMaxClientConn: 1000, // PER PgBouncer instance
  // Per-node I/O ceiling carried over from the base model so we can size the api
  // fleet here too (the WS-socket ceiling is a SECOND api-fleet constraint).
  perNodeIoRps: 220,
  perWorkerJobsPerSec: 120,
  jobsPerCreate: 17,
};

const SLO = { p95Ms: 1500 };
const SECONDS_PER_DAY = 86_400;

// ─────────────────────────────────────────────────────────────────────────────────
// CLI overrides
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
const KNOWN = [DEMAND, MEASURED, INFRA];
const unknown = [];
for (const k of Object.keys(overrides)) {
  const target = KNOWN.find((o) => k in o);
  if (target) target[k] = overrides[k];
  else unknown.push(k);
}
if (unknown.length) {
  const all = KNOWN.flatMap((o) => Object.keys(o)).sort();
  console.error(
    `capacity-model-1m: unknown override(s): ${unknown.map((k) => '--' + k).join(', ')}\n` +
      `Keys are case-sensitive camelCase. Valid: ${all.join(', ')}`,
  );
  process.exit(1);
}
for (const obj of KNOWN)
  for (const [k, v] of Object.entries(obj))
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      console.error(
        `capacity-model-1m: invalid input ${k}=${JSON.stringify(v)} (need finite ≥ 0)`,
      );
      process.exit(1);
    }

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 4 — THE MATH
// ─────────────────────────────────────────────────────────────────────────────────
const peakFactor = DEMAND.peakHourShare * 24;
const avgRps = (DEMAND.dau * DEMAND.reqsPerUserPerDay) / SECONDS_PER_DAY;
const peakRps = avgRps * peakFactor;

// Peak delivery CREATE rate (the only write that fans worker jobs).
const peakCreateRps =
  ((DEMAND.dau * DEMAND.deliveryCreatesPerUserPerDay) / SECONDS_PER_DAY) *
  peakFactor;

// ── Position-frame rate = the hot DB-write + pub/sub-publish rate ────────────────
// SIM path: each create emits positionTicksPerDelivery frames spread over its flight,
// so the steady frame rate ≈ createRate × ticksPerDelivery (each tick is one upsert +
// one publish). This is the per-second average across the flight window.
const simFramesPerSec =
  peakCreateRps *
  (1 - DEMAND.liveSharePct / 100) *
  DEMAND.positionTicksPerDelivery;

// LIVE path: a live delivery streams liveFrameHz for liveFlightMinutes. The number of
// live deliveries CONCURRENTLY in flight = createRate(live) × flightSeconds (Little's
// Law). Each streams liveFrameHz frames/sec → liveFramesPerSec = concurrentLive × Hz.
const liveCreateRps = peakCreateRps * (DEMAND.liveSharePct / 100);
const liveFlightSeconds = DEMAND.liveFlightMinutes * 60;
const concurrentLiveInFlight = liveCreateRps * liveFlightSeconds;
const liveFramesPerSec = concurrentLiveInFlight * DEMAND.liveFrameHz;

const positionFramesPerSec = simFramesPerSec + liveFramesPerSec;

// (1) DB-PRIMARY WRITE ceiling. Every frame is one updateTracking() UPSERT. Status
// CAS writes (5 stage transitions/create) add a smaller stream; so do the per-status
// notification rows (each NotificationsService.create() is a primary write the base
// model omits). All three hit the ONE primary; sum them honestly.
const stageWritesPerSec = peakCreateRps * 5;
const notifyWritesPerSec = peakCreateRps * DEMAND.notifyWritesPerDelivery;
const dbWritesPerSec =
  positionFramesPerSec + stageWritesPerSec + notifyWritesPerSec;
const dbWriteShards = Math.ceil(
  dbWritesPerSec / MEASURED.dbPrimaryUpsertsPerSec,
);

// (2) REDIS pub/sub fan-out ceiling. Each frame publishes once; delivered-messages =
// publishes × avgSubscribingReplicas (only TRACKED deliveries have subscribers).
const trackedFramesPerSec = positionFramesPerSec * DEMAND.trackedFraction;
const pubsubDeliveriesPerSec =
  trackedFramesPerSec * DEMAND.avgSubscribingReplicasPerDelivery;
// Pub/sub does NOT shard in Redis Cluster — a real broker (NATS/Kafka) or N
// independent Redis pub/sub instances sharded by deliveryId is required to scale it.
const pubsubShards = Math.ceil(
  pubsubDeliveriesPerSec / MEASURED.pubsubDeliveriesPerSecPerNode,
);

// (3) REDIS throttler INCR ceiling — every request, dedicated throttle Redis.
const throttleOpsPerSec = peakRps * DEMAND.throttleOpsPerRequest;
const throttleShards = Math.ceil(
  throttleOpsPerSec / MEASURED.redisOpsPerSecPerNode,
);

// (4) BullMQ queue ops ceiling — jobsPerCreate jobs, each several Redis ops.
const queueJobsPerSec = peakCreateRps * INFRA.jobsPerCreate;
// Redis ops per job lifecycle. BullMQ touches Redis several times per job (add,
// move-to-active, lock-renew, complete, event XADD) and DELAYED jobs add a ZADD +
// ZRANGEBYSCORE promotion — and 12 of the 17 jobs/create are delayed (position ticks
// + stage transitions), so the delayed path dominates. 8 is a defensible average for
// a delayed-heavy workload (vs ~4–6 for purely immediate jobs).
const QUEUE_OPS_PER_JOB = 8;
const queueOpsPerSec = queueJobsPerSec * QUEUE_OPS_PER_JOB;
const queueShards = Math.ceil(queueOpsPerSec / MEASURED.bullmqOpsPerSecPerNode);

// ── api fleet: BOTH the I/O ceiling AND the WS-socket ceiling ────────────────────
const peakIoRps = peakRps; // (read+write+login all hit api; signup sized in base model)
const apiNodesIo = Math.ceil(peakIoRps / INFRA.perNodeIoRps);
// Concurrent WS sockets = concurrent tracked in-flight deliveries. socketHoldSeconds
// is an explicit ASSUMPTION dial (see DEMAND) — the real number is the realtime-tier
// KEDA gauge, not this estimate.
const concurrentInFlight =
  peakCreateRps * (1 - DEMAND.liveSharePct / 100) * DEMAND.socketHoldSeconds +
  concurrentLiveInFlight;
const concurrentSockets = concurrentInFlight * DEMAND.trackedFraction;
const apiNodesWs = Math.ceil(
  concurrentSockets / MEASURED.wsSocketsPerApiReplica,
);
const apiNodes = Math.max(apiNodesIo, apiNodesWs);
const apiBoundBy = apiNodesWs > apiNodesIo ? 'WS sockets' : 'I/O rps';
const workerNodes = Math.ceil(queueJobsPerSec / INFRA.perWorkerJobsPerSec);

// ── PgBouncer client-conn budget — NOW per-pooler with sharding ──────────────────
// Single pooler: api×10 + worker×5 vs 1000. Past ~95 api nodes you MUST run multiple
// poolers (one per DB write-shard, or a HA pooler pair per shard). Report both.
const totalClientConns =
  apiNodes * INFRA.apiPoolMax + workerNodes * INFRA.workerPoolMax;
const poolersNeeded = Math.ceil(
  totalClientConns / INFRA.pgbouncerMaxClientConn,
);
const apiNodeCeilingOnePooler = Math.floor(
  (INFRA.pgbouncerMaxClientConn - workerNodes * INFRA.workerPoolMax) /
    INFRA.apiPoolMax,
);
const connPerPooler = Math.ceil(totalClientConns / Math.max(poolersNeeded, 1));

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 5 — OUTPUT
// ─────────────────────────────────────────────────────────────────────────────────
const f = (n, d = 0) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

console.log('');
console.log(
  '═══ Drovery capacity model · 1M+ EXTENSION — the single-Redis/primary ceilings ═══',
);
console.log('');
console.log(
  `Target: ${f(DEMAND.dau)} DAU · peak ×${peakFactor.toFixed(2)} avg-hour · ` +
    `live share ${DEMAND.liveSharePct}% @ ${DEMAND.liveFrameHz}Hz · SLO p95 ≤ ${SLO.p95Ms}ms`,
);
console.log(
  `Hot path: peak ${f(peakCreateRps, 1)} creates/s → ${f(positionFramesPerSec)} position frames/s ` +
    `(sim ${f(simFramesPerSec)} + live ${f(liveFramesPerSec)})`,
);
console.log(
  `          each frame = 1 DB upsert + 1 Redis publish. ${f(concurrentSockets)} concurrent WS sockets.`,
);
console.log(
  `⚠ ILLUSTRATIVE: the per-node ceilings (dbPrimaryUpsertsPerSec, redis/bullmq ops, sockets) are`,
);
console.log(
  `  conservative PLACEHOLDERS (FILL FROM RUN). Shard counts below are PLANNING ESTIMATES, not measured.`,
);
console.log('');

const COLS = [40, 22, 16, 10];
const row = (a, b, c, d) =>
  `│ ${pad(a, COLS[0])} │ ${padL(b, COLS[1])} │ ${padL(c, COLS[2])} │ ${padL(d, COLS[3])} │`;
const sep = (l, m, r) => l + COLS.map((w) => '─'.repeat(w + 2)).join(m) + r;

console.log(sep('┌', '┬', '┐'));
console.log(row('NEW ceiling (1M+)', 'Demand', 'Per-node ceil', 'Shards'));
console.log(sep('├', '┼', '┤'));
console.log(
  row(
    'DB-PRIMARY writes (upserts/s)',
    `${f(dbWritesPerSec)}/s`,
    f(MEASURED.dbPrimaryUpsertsPerSec),
    dbWriteShards,
  ),
);
console.log(
  row(
    'Redis PUB/SUB (delivered msgs/s)',
    `${f(pubsubDeliveriesPerSec)}/s`,
    f(MEASURED.pubsubDeliveriesPerSecPerNode),
    pubsubShards,
  ),
);
console.log(
  row(
    'Redis THROTTLER (INCR/s)',
    `${f(throttleOpsPerSec)}/s`,
    f(MEASURED.redisOpsPerSecPerNode),
    throttleShards,
  ),
);
console.log(
  row(
    'Redis BULLMQ (queue ops/s)',
    `${f(queueOpsPerSec)}/s`,
    f(MEASURED.bullmqOpsPerSecPerNode),
    queueShards,
  ),
);
console.log(sep('└', '┴', '┘'));
console.log('');

console.log(
  'Fleet (this extension; cross-check base model for signup/io detail):',
);
console.log(
  `  api    : ${apiNodes} nodes  (I/O needs ${apiNodesIo}, WS-sockets need ${apiNodesWs} → bound by ${apiBoundBy})`,
);
console.log(
  `  worker : ${workerNodes} nodes  (${f(queueJobsPerSec)} jobs/s ÷ ${INFRA.perWorkerJobsPerSec})`,
);
console.log('');

console.log(
  'PgBouncer client-conn budget — per pooler (the ~95-api-node wall):',
);
console.log(
  `  total client conns : ${apiNodes}×${INFRA.apiPoolMax} (api) + ${workerNodes}×${INFRA.workerPoolMax} (worker) = ${totalClientConns}`,
);
console.log(
  `  one pooler ceiling  : ${apiNodeCeilingOnePooler} api nodes max before MAX_CLIENT_CONN=${INFRA.pgbouncerMaxClientConn} is hit`,
);
console.log(
  `  poolers needed      : ${poolersNeeded}  (≈ ${connPerPooler} client conns each) ` +
    `${poolersNeeded <= 1 ? '✅ one pooler still fits' : '⚠ shard the pooler (one per DB write-shard)'}`,
);
console.log('');

// ── Verdict: the tightest NEW ceiling ──
const newTiers = [
  { name: 'DB-primary writes', shards: dbWriteShards },
  { name: 'Redis pub/sub', shards: pubsubShards },
  { name: 'Redis throttler', shards: throttleShards },
  { name: 'Redis BullMQ', shards: queueShards },
];
const worst = newTiers.reduce((a, b) => (b.shards > a.shards ? b : a));
console.log(
  `VERDICT: at ${f(DEMAND.dau)} DAU the binding NEW ceiling is ${worst.name} ` +
    `(needs ${worst.shards} shard${worst.shards === 1 ? '' : 's'}). ` +
    `Split Redis per-concern + shard the hot tier; offload position writes to a hot-store ` +
    `(Redis last-position + async DB checkpoint) to collapse DB-primary writes.`,
);
console.log('');

// ── SENSITIVITY: the live-fleet dials dominate the hot path ──
console.log(
  'Sensitivity (frames/s & DB write-shards; the live dials dominate):',
);
for (const [label, mut] of [
  ['liveSharePct 0→10%', { liveSharePct: 10 }],
  ['liveSharePct 0→20%', { liveSharePct: 20 }],
  ['liveFrameHz 1→2 (@20%)', { liveSharePct: 20, liveFrameHz: 2 }],
]) {
  const d = { ...DEMAND, ...mut };
  const lc = peakCreateRps * (d.liveSharePct / 100);
  const cl = lc * d.liveFlightMinutes * 60;
  const lf = cl * d.liveFrameHz;
  const sf =
    peakCreateRps * (1 - d.liveSharePct / 100) * d.positionTicksPerDelivery;
  const frames = sf + lf;
  const dbw = frames + peakCreateRps * (5 + d.notifyWritesPerDelivery);
  console.log(
    `  ${pad(label, 26)} → ${padL(f(frames), 10)} frames/s · ${padL(Math.ceil(dbw / MEASURED.dbPrimaryUpsertsPerSec), 3)} DB write-shards`,
  );
}
console.log('');
