# Drovery — Scaling to 1,000,000+ users

`ARCHITECTURE.md` took Drovery to **100k** users (stateless API + worker tier, PgBouncer,
read replicas, full delivery-graph partitioning, HPA/KEDA autoscaling). This document is the
plan for the next **10×**, to **1M+**. It is grounded in the current code and in two pure-Node
capacity models (`loadtest/capacity-model-1m.mjs`, `loadtest/capacity-model-multiregion.mjs`).

> **The numbers in this doc are ILLUSTRATIVE.** Every per-node ceiling in the capacity models
> (`dbPrimaryUpsertsPerSec`, Redis/BullMQ ops/s, sockets/node, bcrypt ms/hash) is a conservative
> **placeholder** marked `FILL FROM RUN`. The shard counts below are *planning estimates*, not
> measurements — they tell you **which tier binds first and roughly when**, not an exact node
> count. Pin the real ceilings (pgbench, redis-benchmark, a ws soak test on the target hardware)
> before treating any shard count as a commitment.

---

## 0. The one insight

The stateless tiers Drovery already autoscales — **API (HPA on CPU)** and **worker (KEDA on
queue depth)** — are **not** the 1M+ wall. The base model gives ~8 api + 16 worker at 2M DAU and
they scale linearly. What changes at 10× is the appearance of **three new "single-thing"
ceilings** the base model never expressed — each a *state tier* that scales by **splitting**, not
by adding stateless replicas:

1. **The single Postgres PRIMARY write rate.** Every position upsert, status CAS, notification
   row, and the `create()` transaction funnels through one primary. `createdAt` RANGE-partitioning
   helped storage / vacuum / retention — it did **not** raise write throughput (all monthly
   children live on one primary).
2. **The single Redis carrying four concerns** (queue + cache + pub/sub + throttler) — a
   single-threaded saturation point and a shared failure domain, with pub/sub fan-out that
   **does not shard in Redis Cluster** (Cluster *broadcasts* pub/sub, making egress worse).
3. **Concurrent WebSocket sockets per replica**, today behind a CPU HPA that is *blind* to mostly-
   idle long-lived sockets.

And the sharpest finding from the capacity model: at **pure-sim 2M DAU everything still fits one
DB shard / one pooler**. It is the **LIVE-drone telemetry firehose** (`liveSharePct × liveFrameHz`),
not raw DAU, that first forces a write-shard (~2 shards at 2M @ 20%-live @ 2Hz, *illustrative*). So
the highest-value build is **offloading the position firehose off the primary**, which *defers*
sharding rather than rushing into it.

```
                        ┌──────────── edge: CDN + WAF + anycast LB ────────────┐
   mobile · drones ─────►  /api/* (HTTP)            WS upgrade                  │
                        │      │                        │                       │
                        │   API tier (HPA/CPU)     REALTIME tier (KEDA/sockets) │  ← carved out
                        │   stateless, pure-HTTP   gateways + pub/sub subscribers│
                        │      │                        │                       │
              ┌─────────┴──────┴────────┐         ┌──────┴───────── fan-out bus ─┐
              │  per-concern Redis:     │         │ sharded Redis pub/sub or     │
              │  queue · cache · throttle│        │ NATS/Kafka (sharded by id)   │
              └──────────┬──────────────┘         └──────────────────────────────┘
       worker tier ──────┤                              hot-store (Redis last-position)
       (KEDA/queue)      │                                       │ async checkpoint
                  shard router (by deliveryId hash → region later)│
              ┌──────────┴───────────┐  ┌───────────┐            ▼
              │ shard 0: primary+repl│  │ shard N…  │     batched DB checkpoint
              │ + PgBouncer          │  └───────────┘     (status stays in Postgres)
              └──────────────────────┘
```

---

## 1. What this PR ships vs. what it designs

This is a **design + buildable-seams** deliverable. To avoid over-claiming, here is the exact split.

### ✅ Built + verified in this PR (additive; default behaviour byte-identical)

| Artifact | Files | Verified |
|---|---|---|
| **1M+ capacity model** | `loadtest/capacity-model-1m.mjs` | runs pure-Node; models the 4 new ceilings (DB-primary writes, Redis pub/sub egress, throttler INCR/s, BullMQ ops/s) + the live-fleet dials + per-pooler PgBouncer budget |
| **Multi-region capacity model** | `loadtest/capacity-model-multiregion.mjs` | runs; per-region write/pub-sub/socket ceilings + cross-region RPO |
| **Shard-key util** | `src/common/sharding/shard-key.ts` (+ spec) | FNV-1a-32; `shardCount=1` ⇒ inert (returns 0 / the legacy channel); fail-loud on bad count |
| **Per-concern Redis split seam** | `src/config/redis.ts`, `src/config/configuration.ts` (+ `redis.spec.ts`) | `buildRedisOptions(config, role?)` with per-field fallback; **unset ⇒ single Redis, byte-identical** |
| **Redis role wired at all 7 call sites** | `app.module.ts` (throttle, queue), `cache.module.ts` (cache), tracking + support-chat publisher/subscriber (pubsub) | inert until a `REDIS_<ROLE>_HOST` env is set |

These are **inert seams**: introducing them changes nothing at runtime (the full test suite stays
green), but a later phase **flips a flag / sets an env var** instead of refactoring under load.

### 📐 Designed here, built later (with the prerequisites each needs)

| Design item | Why not now | Prerequisite |
|---|---|---|
| **✅ Tracking hot-store + checkpoint consumer** (§3) — **SHIPPED** | producer + worker checkpoint consumer landed together, default-OFF (`TRACKING_HOT_STORE=redis`); a boot guard (`assertCheckpointSafe`) asserts the checkpoint cadence clears the watchdog window | the **monotonic-seq** guard (§3.1) is still deferred — it ships with the *same* last-write-wins position semantics as today (no regression) |
| **✅ `PROCESS_ROLE=realtime` tier** (§4) — **SHIPPED** | done NOT via a fragile slim module but a centralized role taxonomy (`src/common/process-role.ts`: `IS_WORKER_TIER`/`IS_HTTP_TIER`/`IS_INGEST_TIER`): `realtime` boots `main.ts` (HTTP + `WsAdapter`) and runs **only** the WS gateways — worker processors + MQTT ingest are gated off; the Ingress routes the WS upgrade here, `/api/*` to the api tier. k8s deployment/service/ingress + a KEDA `ScaledObject` on `drovery_ws_connections`. Additive — api/worker/dev are byte-identical; boot-smoked per role. | — |
| **✅ Position coalescer + WS backpressure** (§4) — **SHIPPED** | `POSITION_PUSH_HZ` caps the per-delivery publish rate (default off); `WS_MAX_BUFFERED_BYTES` drops a *position* frame to a backed-up socket. **Status transitions are never coalesced or dropped** (both the publisher and the gateway honor this). | — |
| **✅ Sharded pub/sub transport** (§4) — **SHIPPED** | `REDIS_PUBSUB_MODE=sharded` flips the tracking + support-chat fan-out from `PUBLISH/SUBSCRIBE` to `SPUBLISH/SSUBSCRIBE` (Redis 7.0+) via a thin `src/common/pubsub/pubsub-transport.ts` seam — both publisher classes and both subscriber classes read the mode once at connect time. Default `standard` = byte-identical to today. Routes by hash slot so the firehose partitions across a Redis Cluster instead of broadcasting to every node. Fail-safe: any non-`'sharded'` value stays standard. Additive; boot-smoked per role. | the **Redis Cluster client** itself (`new Redis.Cluster(...)`) is the remaining follow-up — sharded mode is correct on a standalone Redis 7+ (one shard owns every slot) but only *distributes* once the clients are cluster-aware; both tiers must set the env identically |
| **DB `ShardRouter`** (§2) | **Unbuildable as additive today**: `create()`'s `$transaction` co-commits the delivery with **user-rooted wallet/promo/referral** mutations — a single Prisma tx cannot span two shards, so flipping `shardCount>1` would corrupt wallet balances on the first multi-shard delivery | refactor `create()` balance mutations to an **outbox/saga** (or co-locate users with a home shard) |
| **Firehose hardening** (§6) | two *existing* correctness gaps, independent of sharding | see §6 — do these **before** any sharding |

---

## 2. DB / write tier — the hard ceiling

**Problem.** Every hot write funnels through one primary in `prisma.service.ts` (writes use
`this`; `readWithFallback` only diverts lag-tolerant *reads*). At 2M DAU @ 20%-live @ 2Hz the model
shows **~17k writes/s** on one primary (*illustrative*) — position upserts dominate, plus 5 status
CAS + ~5 notification rows per delivery.

**Fix, in two layers (do them in this order):**

- **L1 — offload the position firehose (biggest payoff, near-term).** Move the high-frequency
  position scalar off the primary entirely (§3). The model shows this collapses ~17k writes/s to a
  handful of batched checkpoint upserts/s — **deferring sharding past 2M** for typical live shares.
  Sharding is the *last* lever, not the first.
- **L2 — horizontally shard the primary (when L1 is exhausted).** A thin `ShardRouter` **above**
  `prisma.service.ts`, keyed on the shipped `deliveryShard(deliveryId, shardCount)`. Each shard =
  `{ primary + N replicas + its own PgBouncer }`; `readWithFallback` runs unchanged *inside* each
  shard; the `createdAt` partition maintenance runs per-shard; `shardCount=1` (unset) = today.

  > **HARD BLOCKER (must resolve first):** `create()`'s `$transaction` co-commits
  > `delivery` + `trackingIdRegistry` + `promo.redeem` + `wallet.debit` + `referral.grant`. The
  > delivery row is shard-local; wallet/promo/referral are user/promo-rooted. A single `$transaction`
  > **cannot span shards**, so the `ShardRouter` is *not* an inert flag — landing it and flipping
  > `shardCount>1` corrupts balances. Resolve via an **outbox/saga** for the balance mutations (with
  > a compensating-refund path), *or* co-locate users with a home shard (simpler, but reintroduces
  > **hot-shard skew** since real traffic is non-uniform across users). This refactor — not the
  > router code — is the real Phase-3 work.

- **`trackingId` global uniqueness under sharding.** The non-partitioned `trackingId` ledger is a
  shared write object inside the `create()` tx today. Prefer **shard-prefixing the public id** (deletes
  the cross-shard registry entirely; it is the *only* option that keeps `create()` single-shard) over
  keeping a shard-0 registry (which makes shard-0 a cross-shard participant for *every* create). The
  prefix is a one-time public-contract bump — migrate mobile / shared links in Phase 2, before sharding.

**Cloud-agnostic → managed.** App-router path first (stock Postgres anywhere): N × (Postgres
StatefulSet | Cloud SQL | RDS/Aurora), each with a PgBouncer sidecar. Transparent-distributed path
later (if cross-shard reporting SQL hurts): Citus / managed Citus / Aurora Limitless / CockroachDB /
Spanner. Cross-shard reporting → **CDC (Debezium) → Kafka → ClickHouse/BigQuery**, never live
scatter-gather.

---

## 3. Telemetry firehose — the highest-value build

> ✅ **Implemented** (env-gated `TRACKING_HOT_STORE=redis`, default OFF — byte-identical when unset):
> `TrackingHotStore` (`writePosition` → Redis hot key + dirty set; `readPosition` for the `getTracking`
> overlay; `drainCheckpoints` SPOP-claims dirty deliveries and batch-upserts them) + a worker-tier
> checkpoint scan mirroring the watchdog (`upsertJobScheduler`, kill-switch teardown, Redis-coordinated
> one-tick-across-replicas) + a boot-time `assertCheckpointSafe()`. The dirty-set drain keeps **today's
> last-write-wins** position semantics (no regression); the monotonic-`seq` guard (§3.1) is a future
> hardening. The hot position is overlaid onto **both** read paths — `TrackingService.getTracking` and
> the mobile poll `DeliveriesService.findOne` (`@Optional` `TrackingHotStore`, no-op when off) — so a
> poll (the WS-down fallback) reflects the live drone within ms rather than at the checkpoint cadence.

The single chokepoint is `TrackingService.updateTracking()` (a `deliveryTracking.upsert` on the
primary) — **both** the sim processor and live telemetry funnel through it, and
`TrackingPublisher.publishUpdate()` is the single Redis publish point.

**Design — env-gated `TRACKING_HOT_STORE=redis`** at that one method:
- **ON:** write last position to a Redis hot key (`HSET delivery:<id>:pos … + EXPIRE ~30m`) and
  `XADD` to a per-shard Redis Stream (`tracking:checkpoint:<shard>` via the shipped `deliveryShard`),
  and **skip** the synchronous per-tick upsert.
- A **new worker-tier coalescing checkpoint consumer** drains the stream on a fixed cadence
  (`CHECKPOINT_INTERVAL_MS ≤ 60s`), **dedupes by `deliveryId` (keep latest)**, and does **one batched
  upsert per delivery per window** via the existing gate-off path — **advancing `tracking.updatedAt`**.
- `getTracking()` reads the hot key first, overlays it onto the checkpointed row, falls back to
  `readWithFallback(findUnique)` on a Redis miss.
- `publishUpdate()` and the `tracking:update` WS payload stay **byte-identical** → subscriber,
  gateway, and mobile contracts untouched. **Status transitions stay in Postgres** — only the
  high-frequency *position scalar* is offloaded.

### 3.1 Correctness constraints (from the adversarial review — these are load-bearing)

- **Watchdog false-reap is LIVE-path-scoped.** `delivery-watchdog` reaps in-flight deliveries whose
  `tracking.updatedAt` is older than `WATCHDOG_SILENCE_MS` (600 000), **but only for
  `trackingSource = LIVE`** (SIMULATED advances on fixed BullMQ jobs and is never reaped on telemetry
  silence). So for the LIVE path the checkpoint cadence **must be ≪ `WATCHDOG_SILENCE_MS`** or live
  drones get false-reaped + refunded — and that bound must be a **hard guard test**
  (`assert CHECKPOINT_INTERVAL_MS < WATCHDOG_SILENCE_MS`), not a comment. For the SIM path the guard
  is irrelevant — but note the checkpoint *consumer itself* becomes a new single-writer: if it falls
  behind, `tracking.updatedAt` stalls and re-arms the very false-reap it guards against, so its drain
  rate is a ceiling to size (and the watchdog should optionally read Redis liveness as a belt-and-braces).
- **`updateTracking()` is last-write-wins, NOT a "monotonic CAS".** Today single-producer ordering is
  incidental; the async checkpoint **removes** that guarantee (a stale frame can clobber a fresher one).
  Add a **required producer `seq` / source timestamp** to the position write and gate the upsert
  (`WHERE incoming.seq > stored.seq`) **before** enabling the hot-store. An "optional `seq?` ignored
  when absent" enforces nothing — make it required on the hot path.
- **Stale-read on a hot-key miss.** On a miss for an *in-flight* delivery the checkpointed row is up to
  `CHECKPOINT_INTERVAL_MS` + replica-lag old. Read the **primary** (not a replica) for an in-flight
  checkpoint, or annotate the response with the checkpoint age.

**Cloud-agnostic → managed.** Hot store / stream: Redis Streams (self-host / CI default) /
ElastiCache / Upstash / MemoryDB; brokers NATS JetStream, Kafka (topic per shard). Optional full
breadcrumb sink later: TimescaleDB hypertable or ClickHouse instead of last-position-only.

---

## 4. Realtime / WebSocket fan-out

Two independent, additive fixes.

1. **Carve out a dedicated realtime tier.** Add a third role to the one-image pattern, but note this
   is **new code, not a flag**: the gateways attach to the HTTP server from `NestFactory.create` +
   `WsAdapter` — the worker's `createApplicationContext` has no HTTP server, so a realtime role needs a
   **new `src/realtime.ts`** booting a slim module that imports *only* the gateways + subscribers (no
   controllers). Scale it with **KEDA on a new `drovery_ws_open_sockets` gauge** (mirroring the proven
   worker `ScaledObject`), **not** a CPU HPA — long-lived tracking sockets are mostly idle (1 frame/5s),
   so CPU is blind to the real FD/event-loop/memory ceiling, and a create-RPS spike must not churn
   socket-holding nodes (every scale-down mass-disconnects clients). Dedicated Ingress path, long
   `proxy-read-timeout` (≥ 3600s), graceful drain, and a **per-socket `bufferedAmount` watermark** so a
   slow client can't balloon node memory.
2. **✅ Sharded pub/sub transport — SHIPPED.** A thin seam (`src/common/pubsub/pubsub-transport.ts`)
   flips the tracking + support-chat fan-out from `PUBLISH/SUBSCRIBE` to `SPUBLISH/SSUBSCRIBE`
   (Redis 7.0+) under `REDIS_PUBSUB_MODE=sharded` (default `standard` = today, byte-identical). Sharded
   pub/sub routes by the channel's hash slot, so a message reaches only the node owning that slot
   instead of broadcasting to every node — turning `O(msgs × all-nodes)` into `O(msgs ×
   node-owning-the-slot)`. **Honesty:** this is correct on a *standalone* Redis 7+ but only
   *distributes* once a `Redis.Cluster` client is wired (the remaining follow-up); both tiers must set
   the env identically (sharded `SPUBLISH` is delivered only to `SSUBSCRIBE`, never to classic
   `SUBSCRIBE`). **Blast-radius note (resolved):** the subscribers still reverse-parse the id from the
   channel string in `dispatch()`, but that string is delivered intact by the `smessage` event too, so
   the parse is mode-agnostic and needed no lockstep change — only the subscribe/publish verbs + the
   listened event switch by mode. Add a **position coalescer** (`POSITION_PUSH_HZ`, default off = pass-through): keep only
   the latest position per delivery, flush at a fixed Hz, but **flush `status` frames immediately**
   (never coalesce a discrete transition) — caps bus + per-socket frame rate independent of a 10 Hz
   live drone (~36× egress cut to 1 Hz).

**Reconnect storms.** A realtime pod death / LB drain triggers a **thundering herd** — tens of
thousands of clients reconnect near-simultaneously, each doing a JWT verify + a per-delivery ownership
re-check (a replica read). Mitigate with a **jittered exponential backoff** client contract, a
**per-pod connection-rate limiter**, and a **short-TTL cache of the ownership decision** so a storm
doesn't translate 1:1 into replica reads.

---

## 5. Queue / Redis / cache / connections

- **Per-concern Redis split — seam shipped + wired (this PR).** `buildRedisOptions(config, role?)`
  resolves a per-role endpoint (`REDIS_QUEUE_/CACHE_/PUBSUB_/THROTTLE_*`) with per-field fallback to the
  shared `REDIS_*`. All 7 call sites pass their role; unset env ⇒ one Redis (byte-identical). **Peel by
  blast radius:** `throttle` first (highest RPS, ~1 667 INCR/s at 2M, *illustrative*), then `pubsub`
  (telemetry hot path), then `queue` (durability isolation — keep KEDA pointed at it), then `cache`
  (fail-open, trivial).
  > **Two caveats the review flagged:** (a) **BullMQ does not shard a single queue across a Cluster** —
  > every key for a queue lives in one hash slot (`{queue}` tag), so the queue Redis scales by
  > **splitting queues across instances**, not by clustering one. (b) Verify the
  > `ThrottlerStorageRedisService` script is **Cluster-safe** before putting `throttle` on cluster-mode
  > (vs a dedicated single instance) — single-instance is safe regardless.
- **Cache is under-leveraged** (grep shows zero `MGET/EVAL/MULTI` → Cluster-drop-in ready). Add
  cache-aside to read-hot endpoints (`/users/me`, pricing, serviceability, tracking snapshots from the
  hot-store) with short TTLs + fail-open, to move reads off the replicas.
- **Connections.** The PgBouncer ceiling is `floor((1000 − workerNodes×5)/10) ≈ 94 api nodes` **on one
  pooler** — run **one PgBouncer (HA pair) per write-shard** so the ceiling is per-pooler, and extend
  `readWithFallback` to round-robin an env list of N replicas (callers untouched).
- **Delayed-ZSET caveat:** millions of future position/stage ticks live in BullMQ's delayed set; size
  queue-Redis **memory** against `concurrentDeliveries × ~17 delayed jobs`, and confirm the worker
  `ScaledObject` counts `waiting`/`active` (not `delayed`) or KEDA tracks the simulation backlog instead
  of real load.

---

## 6. Firehose hardening — do this BEFORE sharding (independent of scale)

The review surfaced **two real correctness gaps** that get *worse* with more replicas and have nothing
to do with sharding. They belong in **Phase 0/1**, ahead of any DB-shard work.

- **Stripe webhook has no idempotency / ordering guard.** `handleWebhookEvent()` ignores `event.id` and
  does a blind `payment.updateMany({ where:{ stripePaymentIntentId }, data:{ status } })`. Stripe
  webhooks are **at-least-once and can arrive out of order**: a re-delivered `processing` after
  `succeeded` regresses a COMPLETED payment, and a redelivered `payment_failed` can flip COMPLETED→FAILED
  and trigger an erroneous refund. **Fix:** a `webhook_events` table `UNIQUE(event.id)`, INSERT-on-receipt
  (P2002 ⇒ early `{received:true}` dedupe), and a **monotonic status write** (only advance
  PENDING→PROCESSING→COMPLETED; →FAILED only from a non-terminal state) — mirroring the conditional-CAS
  the wallet already uses.
- **Notification / Expo-push fan-out is an unmodeled per-status firehose.** Every status transition does
  a synchronous `notification.create()` on the primary (another high-volume write — *now counted in the
  1M model*) then a single blocking `fetch()` to Expo. **Fix:** move push to a dedicated KEDA-scaled
  `push` queue; **chunk to ≤100 messages/request** (Expo hard-rejects more); persist + poll receipt
  tickets and **delete `DeviceNotRegistered` tokens** (dead tokens accumulate forever today); cap devices
  per user; mind Expo's ~600 notifications/s project limit (evaluate FCM/APNs direct at true scale).

---

## 7. Multi-region / edge (the same shard axis, larger radius)

Geo-sharding and multi-region are the **same axis at two radii**, not two systems. **Recommend
deliveryId-HASH sharding first** (even distribution, no rebalancing math, the shipped util); promote to
**`SERVICE_AREA` geo-sharding** only when **data residency / sovereignty** forces it — the `SERVICE_AREAS`
hub model is a clean region key (a delivery never crosses a hub mid-flight). Then: region-local
read/write, **active-active primaries per region** extending the same `ShardRouter`/`readWithFallback`
boundary; a **single global primary** for auth / identity / billing (~8% of writes, sized to a billing
RPO — the model shows ~800ms lag vs a 1000ms budget); an **edge CDN** for static + cacheable GETs.
**Design-only** until a real residency requirement exists — `capacity-model-multiregion.mjs` is the
planning input (it fires the structural-change verdict at ~20M: 7 write-shards + 12 pub/sub instances in
the hot region).

---

## 8. Phased rollout

| Phase | Users | Must-do |
|---|---|---|
| **0 — today** | ≤100k | **No new state-tier work.** Land the inert seams (shard-key, Redis split + wiring, both capacity models — *this PR*) so later phases flip a flag, not refactor under load. Plus the **firehose hardening** (§6) — it's independent of scale and only gets worse with replicas. |
| **1** | 100k→300k | The **live-telemetry inflection**: ship the **tracking hot-store** (§3) OFF-by-default, enable in a canary (with the seq guard + the `CHECKPOINT_INTERVAL_MS < WATCHDOG_SILENCE_MS` hard test). **Peel `throttle` then `pubsub`** onto dedicated Redis. Add round-robin read replicas. |
| **2** | 300k→1M | **Carve out the `realtime` tier** (§4, new bootstrap + KEDA-on-sockets). Ship the **coalescer + backpressure** guard. Flip `REDIS_PUBSUB_MODE=sharded` (and wire the Redis Cluster client) or move to a broker. Add cache-aside. Adopt **shard-prefixed trackingIds** so the public-id format migrates *before* sharding. |
| **3** | 1M→multi-M | Only once the hot-store-relieved primary approaches its ceiling: **resolve the `create()` cross-shard tx** (outbox/saga), then flip `ShardRouter` to `shardCount>1` (one PgBouncer per shard, per-shard partition maintenance). Stand up **CDC → warehouse** for cross-shard reporting. **Regionalize only if residency requires it.** |

---

## 9. Run the models

```bash
node loadtest/capacity-model-1m.mjs --dau=2000000                          # pure-sim baseline
node loadtest/capacity-model-1m.mjs --dau=2000000 --liveSharePct=20 --liveFrameHz=2   # live firehose
node loadtest/capacity-model-1m.mjs --dau=2000000 --dbPrimaryUpsertsPerSec=6000        # halve the (unmeasured) ceiling
node loadtest/capacity-model-multiregion.mjs --dau=20000000
```

Every dial is overridable. Before any shard count becomes a commitment, replace the `FILL FROM RUN`
ceilings (`dbPrimaryUpsertsPerSec`, `redisOpsPerSecPerNode`, `pubsubDeliveriesPerSecPerNode`,
`bullmqOpsPerSecPerNode`, `wsSocketsPerApiReplica`, bcrypt ms/hash) with at least one isolated measured
run on the **target node class** — until then the projections are illustrative, and the doc says so.

## 10. Open decisions (gate Phase 2/3)

- **`trackingId` under sharding:** shard-prefix the public id (cleanest, deletes the registry, but a
  public-contract bump) vs keep a shard-0 registry. Decide **before** Phase 3; check whether shared
  tracking links in the wild constrain a format change.
- **`create()` cross-shard tx:** outbox/saga (correct, adds eventual consistency + a compensating-refund
  path) vs user co-location (simple, but breaks hash-shard even-distribution). What wallet-consistency
  window is acceptable?
- **Hash-shard vs geo-shard first:** hash unless an early residency requirement forces geo.
- **Realtime bus at Phase 2:** sharded Redis pub/sub (no new infra) vs NATS/Kafka (best fan-out economics
  + replay, but a new dependency and at-least-once to reconcile with today's fire-and-forget).
- **Hot-store durability:** between checkpoints the last position lives only in Redis — confirm a ≤60s
  position gap on a Redis failover is acceptable (position is last-write-wins; **status is never** in the
  hot store).
