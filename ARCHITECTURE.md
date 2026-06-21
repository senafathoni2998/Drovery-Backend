# Drovery — Scaling Architecture (target: 100,000+ users)

This document is the plan to take Drovery from "works on one laptop" to **100k+ users**.
It is grounded in the current code: each section names the real blocker in this repo,
why it breaks at scale, and the concrete fix.

> **Scaling past 100k?** The plan for the next 10× — to **1,000,000+** users, and the new ceilings
> that only appear there (single-primary writes, the position-telemetry firehose, single-Redis,
> WS fan-out, geo-sharding) — is in **[`SCALING-1M.md`](SCALING-1M.md)**.

> TL;DR — the four **hard blockers** this plan opened with are now all **RESOLVED** (this doc
> records the journey; each section's status markers are current):
> 1. ✅ **In-memory delivery simulation** (`setTimeout`) → durable BullMQ jobs on a standalone worker tier (§1).
> 2. 🟡 **Geocoding on public Nominatim** → Redis-cached; a commercial-provider swap is the only remainder (§2).
> 3. ✅ **In-process WebSocket/state** → WS + Redis pub/sub, fans out across replicas (§3).
> 4. ✅ **Single Postgres, no pooling/replicas** → PgBouncer + env-gated read replicas + RANGE partitioning (§4).

---

## 0. Target & shape

- **100k registered users**, assume ~3–5% concurrent at peak (3,000–5,000 concurrent), with bursty "create delivery → track" sessions.
- The API is mostly **stateless request/response + a real-time tracking stream**. That shape scales horizontally *if* we remove the in-process state below.

```
        ┌─────────────┐
 Mobile │  CDN / WAF  │
  apps ─┤  + LB       ├─┬─► API instances (N, stateless, autoscaled)  ─► Postgres (primary)
        └─────────────┘ │                                              └─► Postgres (read replicas)
                        ├─► Realtime tier (WS/SSE) ◄── Redis Pub/Sub ◄─┐
                        └─► Worker tier (BullMQ)  ────────────────────┘
                              ▲
                              └── Redis (queues, cache, pub/sub, rate-limit)
```

---

## 1. ✅ Delivery simulation now runs on a durable queue  *(was the #1 blocker — DONE)*

**Before:** `simulation.service.ts` scheduled `setTimeout`s in the Node process and stored
timers in a `Map`, so you couldn't run more than one instance and a restart stranded every
in-flight delivery.

**Now (implemented):** the lifecycle is **delayed BullMQ jobs in Redis**.
- `SimulationService.startSimulation` enqueues one delayed `stage` job per transition + `position` jobs for the movement ticks (deterministic `jobId = deliveryId:stage:i` / `:pos:j` → idempotent; cancel removes them).
- `SimulationProcessor` (`@Processor`) is the **worker** that advances status, upserts tracking, writes/pushes notifications, broadcasts, and records proof on `DELIVERED`. It guards on `CANCELED`/`DELIVERED` so stale jobs no-op.
- `BullModule.forRootAsync` wires the Redis connection from config (`REDIS_HOST/PORT`).
- Jobs persist in Redis → **survive restarts**; any worker instance drains the queue → **horizontal scale**.

> **Verified**: created a delivery (17 delayed jobs), killed the API mid-flight (jobs remained in Redis), started a fresh instance — the delivery still reached `DELIVERED` with proof recorded.

**Standalone worker (done):** `src/worker.ts` boots the module graph as a Nest application context (no HTTP) and runs the processor — `npm run worker` / `worker:prod`. API instances opt out of consuming with `PROCESS_ROLE=api`, so API and workers scale independently. Worker concurrency is `SIM_WORKER_CONCURRENCY` (default 10); jobs retry with backoff (`attempts: 5`), transitions are an atomic monotonic compare-and-set (no resurrect/regress), and both API and worker `enableShutdownHooks()` to drain on SIGTERM.

**Remaining for true multi-tier scale:** split the producer vs worker Redis connections (finite `maxRetriesPerRequest` + `enableOfflineQueue:false` on the producer so enqueues fail fast), add queue metrics/alerting.

**Live telemetry ingestion (done — ROADMAP #15):** a real drone now *is* an interchangeable producer for the same tracking contract. A delivery is `SIMULATED` (default) or `LIVE` (a `TrackingSource` discriminator fixed at `create()`); LIVE enqueues no sim jobs and is driven by a transport-agnostic `TelemetryService.ingest()` that reuses the **same** monotonic CAS + `TrackingService` + `TrackingPublisher`, so the API and mobile contracts don't change. Primary transport is a `@Public` `POST /ingest/telemetry` with a fail-closed `DroneAuthGuard` (shared key + optional timestamped HMAC); a `MQTT_URL`-gated subscriber is the deferred real-broker path. The ingest core is tier-neutral; the HTTP receiver + MQTT listener run on the API tier (a single ingest owner, not the worker).

> ⚠️ **Redis is now required** to run the backend (the queue connects on boot). `redis-server` on `:6379` (or `REDIS_HOST/PORT`).

## 2. 🟡 Geocoding: Redis cache done; provider swap remaining

**Now:** `GeoService` caches `address → {lat,lng}` (and reverse) in **Redis** via `CacheService` —
30-day TTL for hits, 1-hour negative cache for misses, normalized keys (`geo:fwd:*` / `geo:rev:*`),
fail-open on a cache outage. Repeat addresses no longer hit Nominatim (verified: a cached lookup
returns in ~9 ms vs ~840 ms for a live call). This removes most calls and gets us well under
Nominatim's ~1 req/sec ceiling for typical (repetitive) address traffic.

**Remaining:**
- Swap the upstream to a **commercial/self-hosted geocoder** (Google, Mapbox, or self-hosted Nominatim/Photon) behind the existing `GeoService` abstraction (`geocoding.provider` already in config) — for the cold-cache tail and SLA.
- Make geocoding **async/non-blocking** for create latency: accept the delivery immediately, geocode in the worker, backfill coords. (Today it's awaited inline.)
- Prefer **client-supplied coordinates** from the map picker so the server rarely needs to geocode at all.

> The new `CacheService` is generic — reuse it next for **tracking snapshots** (absorb polling) and **`/users/me` + stats**.

## 3. ✅ Real-time tracking at scale (WS + Redis pub/sub)

**Done (backend).** The `TrackingGateway` (raw `ws`, `WsAdapter` installed) now scales horizontally via **Redis pub/sub**: the **worker** publishes each position/status change to `delivery:<id>:update` (`TrackingPublisher`), and every API instance's `TrackingSubscriber` fans it out to its locally-connected clients — so an update computed in the worker reaches a client on **any** API replica. This decouples "who computed the update" from "who holds the socket." Verified cross-process (separate api + worker).

- **Auth + ownership:** the client authenticates with a JWT in the handshake query (`ws://host/?token=`), and ownership is re-checked per delivery at subscribe (`DeliveriesService.findOne`) — parity with `GET /deliveries/track`. Tokenless → close `1008`.
- **Polling coexists.** `GET /deliveries/:id` (4s mobile poll) and the Postgres writes per tick are untouched — WS is purely **additive**, so polling stays the source of truth and the backstop on a Redis blip. **The mobile app still polls; migrating it to WS is a separate (mobile-repo) task.**
- `drovery_ws_connections` gauge exposes live socket count.
- **Same pattern, second gateway — support chat.** `SupportChatGateway` reuses this design at a **distinct path `/ws/support`** (the `WsAdapter` routes upgrades by exact pathname, so the two gateways coexist and tracking's `/` is untouched — verified live). It differs only in *who publishes*: chat is **API-tier** (a message accepted by the gateway/REST is persisted then published to `support:ticket:<id>:messages`), whereas tracking publishes from the worker. The publisher is **tier-agnostic** (runs everywhere), so a future agent/admin surface on any replica can inject an `AGENT` message with no gateway change. `drovery_ws_support_connections` gauge.
- Next at very high fan-out: a dedicated realtime tier (so sockets scale independently of the API), per-client subscription reverse-index (O(1) disconnect), and tracking-snapshot caching (§2) to absorb the remaining polling.

## 4. ✅ Database: pooling, replicas, partitioning (done — managed-PG + cold archival remain)

**The original problem:** single Postgres via a `pg` Pool per instance (`PrismaService`). At N instances × pool size, you exhaust Postgres connections fast. **All three fixes below shipped** (PgBouncer, replicas, partitioning of the full delivery graph); only a managed/hosted Postgres and cold-row archival remain.

**Fix (in order):**
- **PgBouncer** (transaction pooling) in front of Postgres; point Prisma at it. Essential once N instances > a handful.
- Indexes already exist on `Delivery(userId/status/trackingId)`, `Notification(userId,read)` — good. Add for new access patterns as they appear (e.g. `support_tickets(userId)` exists).
- ✅ **Read replicas** for the heavy read endpoints — **done** (env-gated). `PrismaService` builds a second client on `DATABASE_REPLICA_URL` exposed as `prisma.reader` + a `readWithFallback()` helper (NOT the Prisma read-replica extension — it clones the datasource URL, which a driver-adapter client doesn't carry). Only **lag-tolerant** reads route to the replica (delivery lists / `getActive` / `getRecent` / tracking polls, user stats, notification feed + unread count, wallet/referral display, admin reporting lists + overview); **every** read-after-write / CAS-feeding / auth / `/health/ready` read stays on the primary. **Fail-safe**: unset → reader IS the primary (single-DB dev/test byte-identical); a replica blip falls back to the primary (logged, never a 5xx). Reader pool is separate (`DATABASE_REPLICA_POOL_MAX`); front the replica with its own PgBouncer at scale.
- **Hosted Postgres** with autoscaling storage/replicas (RDS/Aurora/Cloud SQL/Neon).
- ✅ **Time-range partitioning — `notifications` done** (migration `20260616120000_partition_notifications`; the reference pattern, applied to the cleanest target first). `notifications` is now PostgreSQL `RANGE("createdAt")`-partitioned into **monthly children + a permanent `DEFAULT`** (catches any timestamp so an insert can never fail with "no partition found"). Mechanics that generalize:
  - **Copy-swap raw-SQL migration** (PG can't convert a populated table in place; Prisma can't express partitioning): rename old → create partitioned parent via `LIKE … INCLUDING DEFAULTS` + composite PK → recreate the index/FK under their exact Prisma names → backfill through the `DEFAULT` then drain → drop old. Single transaction. Precedent: the `drone_commands` partial-index migration.
  - **Composite PK `@@id([id, "createdAt"])`** (id-first): a range-partitioned table requires the partition key in every key. The model change makes `prisma migrate diff` **clean** (proven) — keeping `id @id` would make every `migrate dev` emit a destructive PK-collapse that fails on a partitioned parent. Drift is gated in CI by `npm run prisma:drift-check`. The only code cost: `notifications.markAsRead` is now an ownership-scoped `updateMany({id,userId})` (also a security win — 404 not a 403 oracle). `prisma db push` is **forbidden** here (deploy-only) — see `prisma/PARTITIONING.md`.
  - **No-extension maintenance** (no `pg_partman`/`pg_cron` assumed): table-parameterized plpgsql routines `partition_drain_default` / `partition_ensure(months_ahead)` / `partition_drop_old(retain_months)` + a permanent `DEFAULT`, driven by a worker-tier Redis-coordinated repeatable scan (`src/partition-maintenance/`, mirrors the watchdog: kill-switch, NaN-safe knobs, metrics — `drovery_partition_*`). `drain_default` runs first each tick (a bare `CREATE … PARTITION OF` fails when the `DEFAULT` already holds in-range rows; the routine builds the child standalone, relocates the rows, then `ATTACH`es). Verified without scale by `scripts/verify-partitions.sql` (routing, default-catch, drain-heal, retention) + a live Prisma CRUD pass.
- ✅ **Delivery graph — partitioned (Phase 1 + 2, done).** Covers (`deliveries` + `delivery_tracking`/`payments`/`proof_of_delivery`/`delivery_ratings`/`workflow_step_completions`/`drone_commands`); the unbounded N:1 children (`workflow_step_completions`, `drone_commands`) are co-partitioned by `deliveryCreatedAt` so retention is an O(1) `DROP`. The two extra problems the leaf `notifications` didn't have were solved as predicted: (a) **global `trackingId` uniqueness** — a partitioned table can't enforce a unique that omits the partition key, so `UNIQUE(trackingId)` alone is impossible; rely on the existing collision-safe generator + a small non-partitioned `trackingId` ledger (or a `UNIQUE(trackingId,"createdAt")` accepting per-window scope). (b) **composite-FK fan-out** — every child FK to `deliveries(id)` must become `(id,"createdAt")`, so each child gains a `deliveryCreatedAt` column. **Trigger:** when `deliveries`/`notifications` exceed ~50–100M rows or autovacuum/index bloat degrades hot list queries (visible on the Grafana dashboards). At scale, replace the single-statement backfill with a month-by-month batched copy under a dual-write window (the `partition_*` routines are reused) — see the runbook.
- ✅ **`trackingId` collision-safe** — **done**. `create()` wraps the insert (plain + the promo/credit/referral `$transaction`) in a bounded retry: on a `P2002` whose target is `trackingId`, regenerate the 8-char id and retry (the whole tx rolls back so promo/credit/referral re-run cleanly); other `P2002`s propagate; exhaustion → `409`.

## 5. Caching tier (Redis)

Introduce Redis as a first-class cache, not just a queue:
- **Geocode cache** (§2), **FAQ/workflow static data**, **`/users/me` & stats** (short TTL), **tracking snapshots** (1–2s TTL absorbs polling storms — 5,000 trackers polling a cached snapshot is cheap).
- Cache-aside with explicit invalidation on writes.

## 6. Stateless API + autoscaling

- The API is already close to stateless (JWT auth, no session store) — **once §1/§3 in-process state is gone, it autoscales cleanly**.
- Containerize, run on **Kubernetes / ECS / Cloud Run** with HPA on CPU + p95 latency. Health/readiness probes. Rolling deploys.
- ✅ **Config validated on boot** — `validate` refuses to boot in production with weak/placeholder JWT secrets.

## 7. Auth at scale

- Access tokens are stateless JWT (good — no per-request DB hit). Access tokens short (15m), with a unique `jti`.
- ✅ **Refresh-token store + rotation + revocation** done (`RefreshToken` table; hashed; rotated on every refresh; `POST /auth/logout` revokes). A stolen-but-rotated/expired token is rejected. *(Next: prune expired/revoked rows on a schedule; optionally move the store to Redis.)*
- Consider moving auth to a managed IdP (Cognito/Auth0/Clerk) if you don't want to own this.

## 8. Push notifications at scale

- `NotificationsService.create()` now fans out to Expo Push (`exp.host`) per-user. At scale:
  - **Batch** Expo messages (100/request) and run sends in the **worker tier**, not inline on the request path.
  - Use **`expo-server-sdk`** for chunking + receipt handling; prune dead tokens (DeviceNotRegistered).
  - Rate-limit and retry with backoff.

## 9. Rate limiting, resilience, abuse control

- ✅ **`@nestjs/throttler`** — 100/min/IP global, 10/min on `/auth`. *(Use a Redis storage adapter for multi-instance correctness.)*
- Timeouts + **circuit breakers** on outbound calls (geocoder, Expo, Stripe). *(Geocode + enqueue already have timeouts/fail-open.)*
- Idempotency keys on `POST /deliveries` and payments to survive client retries.
- ✅ CORS allowlist (`CORS_ORIGINS`).
- ✅ **Bidirectional drone commands (operator → drone)** — a `DroneCommand` outbox lets an ADMIN command an in-flight LIVE drone (`RETURN_TO_BASE`/`ABORT`). The drone polls + acks over the same `/ingest` transport (`DroneAuthGuard`); the **ack** is the sole trigger that drives the delivery via the existing `beginReturnToBase`/`failExceptional` CAS (issue/poll never mutate it). A partial-unique index bounds it to one open command per delivery; the ack claim CAS makes duplicates a no-op 409; TTL expiry + stranded-ack reconciliation fold into the watchdog tick. The ingest HMAC binds method+path so a captured signature can't be retargeted across routes. Hardware-free (the drone is a mock poll/ack client; MQTT push deferred).
- ✅ **Stuck-delivery watchdog (self-healing reaper)** — a worker-tier repeatable scan (`upsertJobScheduler`, mirrors the recurring materializer; one tick across all replicas) reaps `LIVE` in-motion deliveries whose telemetry has gone **silent** past `WATCHDOG_SILENCE_MS` (default 10m), so a lost-comms drone or a dead return flight reaches a real terminal (`DELIVERY_FAILED` + refund) instead of stranding in-flight. Silence is keyed on the **tracking row's** `updatedAt` (bumped by every position frame) — the SQL gate *and* ordering use it, so a healthy long-haul flight never crowds a genuinely-silent one out of the bounded batch. Reuses `failExceptional`'s single-winner CAS (idempotent, multi-replica safe; a real frame that arrives first no-ops the reap). `SIMULATED` deliveries are excluded (the sim owns them); `AWAITING_HANDOFF` is excluded (no time bound). Kill-switch `WATCHDOG_ENABLED` tears down the persisted scheduler on a disabled boot. Observable via `drovery_watchdog_reaped_total` + a last-scan **heartbeat gauge** (`time() - gauge > N` alerts on a silently-dead reaper).

## 10. Observability (you can't scale what you can't see)

- ✅ **Structured logging** (pino via `nestjs-pino`) with per-request correlation ids (`X-Request-Id`, propagated/echoed), auth header redaction, pretty in dev / JSON in prod. Ship the JSON to a log store.
- ✅ **Health probes**: `GET /health` (liveness) + `GET /health/ready` (DB + Redis, 503 when down) — public, un-throttled, k8s-ready.
- ✅ **Error tracking** (Sentry, `@sentry/node`) — unhandled 5xx reported from the global exception filter; DSN-gated (no-op without `SENTRY_DSN`); wired into both the API and worker entrypoints.
- ✅ **Metrics** (Prometheus, `prom-client`) — `GET /api/v1/metrics`: default Node/process metrics, an HTTP histogram + counter labelled by route **template** (cardinality-safe), a `drovery_queue_jobs{queue,state}` gauge from BullMQ `getJobCounts()` across **all** worker queues (simulation/recurring/watchdog — the simulation depth is the signal the worker autoscaler scales on), and the watchdog reaper metrics (`drovery_watchdog_reaped_total{status}` + a last-scan heartbeat gauge + a per-replica scheduler-registered gauge). The headless worker serves the same registry at `:9091/metrics`.
- ✅ **Grafana dashboards + SLO alerts** — **done** (as code, over the existing metrics). `observability/`: `prometheus.yml` (scrapes api `/api/v1/metrics` + worker `:9091/metrics`), `alerts.yml` (5xx-rate warn 2% / page 5%, p99 latency by route, `/health/ready` 503s, queue backlog using `max` not `sum` = the KEDA signal, failed-job climb, event-loop lag, target-down), and two provisioned dashboards (`drovery-api`, `drovery-workers`). `docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up` brings up Prometheus (`:9090`) + Grafana (`:3001`) locally. A replica fallback is logged (and surfaces via the readiness/error panels).
- ✅ **Interactive API docs (OpenAPI/Swagger)** — `@nestjs/swagger` + CLI plugin → browsable docs at `/api/v1/docs` (+ `/api/v1/docs-json`) over the full route surface, schemas auto-inferred from DTO types at build time. Bearer + `x-ingest-key` security schemes; the `{success,data,timestamp}` envelope + `ApiErrorDto` errors are made first-class via a doc post-process (so codegen clients get the real shape); `@PublicApi()` keeps the guard + doc public-ness in lockstep. `SWAGGER_ENABLED` kill-switch (on by default — portfolio showcase). NOTE: the swagger CLI plugin runs only during `nest build`; production serves from `dist/` so schemas are populated, but a ts-node run would show empty schemas.
- ✅ **Distributed tracing** API → worker → DB — **done** (OpenTelemetry, `src/common/monitoring/tracing.ts`). A standalone NodeSDK mirroring the Sentry real-or-mock seam, **OFF by default** (zero overhead, the test suite is byte-identical) and **fail-open** (a bad endpoint/instrumentation degrades to untraced, never crashes boot). Enabled via `TRACING_ENABLED` / an OTLP endpoint, **and only when `SENTRY_DSN` is unset** (Sentry owns OTel when a DSN is present — one owner). Auto-instruments http/express/pg/ioredis (the pg driver-adapter is traced), ignores the `/metrics` + `/health` scrape paths, samples `ParentBased(TraceIdRatio)` (0.05 in prod, 1 in dev). **Cross-tier**: the producer's W3C context is injected into BullMQ job data at enqueue and a CONSUMER span is started from it in the worker, so **one `traceId` spans the create request → queue → worker → DB** (verified live with the console exporter). Logs carry `trace_id` (pino mixin); spans flush on SIGTERM. Console exporter for local verify; OTLP-HTTP to a real collector in prod.

## 11. Delivery/CI & cost

- CI runs the test suites (already present, green) + lint + typecheck + `prisma migrate deploy` on deploy.
- Load-test (k6/Artillery) the create→track→deliver path before each scale milestone.
- Autoscale down off-peak; the worker/realtime tiers scale independently of the API.

---

## 12. Shipped beyond this plan

Capabilities added after the original scaling plan — all in-repo and verified:

- **Delivery-graph partitioning (Phase 1 + 2)** — see §4; the full delivery graph + the
  unbounded N:1 children are RANGE-partitioned, with generic self-discovering plpgsql
  maintenance and inbound-FK-aware retention.
- **MQTT push transport** — an opt-in (`MQTT_URL`-gated) MQTT5 path that coexists with the HTTP
  `/ingest` endpoints; shared subscriptions (`$share/`) ensure one api replica processes each
  frame. The dependency-free `MqttModule` is fail-open (a down broker never blocks boot).
- **i18n depth (en/id)** — boundary-localized: business errors + validation throw a *key*,
  translated once in the exception filter via a persisted `User.locale`; email templates too.
- **Capacity model + node-isolated load-test harness** (`loadtest/`) — bounds each replica to a
  known CPU/mem unit so per-node throughput is attributable, isolates the bcrypt wall from pure
  I/O, and projects measured per-node numbers to a 100k-DAU node count.
- **drovery-admin operator console** (separate repo) — a React/MUI web app on the role-gated
  `/admin` API: dashboard, delivery oversight (force-cancel/fail/refund/drone commands), promo
  CRUD, user roles, and a live (WS) support inbox.

---

## Phased rollout

| Phase | Users | Must-do |
|------|-------|---------|
| **0 — now** | <1k | Single API + Postgres + polling. ✅ config validation (weak-secret boot guard), ✅ rate limiting (`@nestjs/throttler`), ✅ refresh-token rotation/revocation, ✅ CORS allowlist, ✅ owner-scoped tracking, ✅ structured logging (pino + request ids), ✅ health/readiness probes, ✅ Sentry error tracking, ✅ Prometheus `/metrics`. |
| **1** | ~10k | ✅ **BullMQ worker tier** + standalone `worker` + `PROCESS_ROLE` split; ✅ **Redis geocode cache** (`CacheService`); ✅ **PgBouncer** pooling tier (docker-compose); ✅ producer/worker/cache/throttler Redis connections split (shared options, per-role flags) + cloud-ready (auth/TLS). Remaining: cache tracking-snapshots/stats, commercial geocoder. |
| **2** | ~50k | Multiple API instances + ✅ **autoscaling** (✅ containerized, ✅ K8s **HPA** on api CPU + **KEDA** on worker queue depth, multi-instance-safe: ✅ Redis-backed throttler, ✅ bounded pg pool + PgBouncer), ✅ **Prometheus metrics**, ✅ **k6 load test** harness. Remaining: **read replicas**, batched Expo push in worker, Grafana dashboards/alerts. |
| **3** | 100k+ | ✅ **Real-time tracking** (WS + Redis pub/sub, auth+ownership) — worker publishes, any API replica fans out; polling kept as backstop. Remaining: dedicated realtime tier (sockets scale apart from API), partition/archive old rows, multi-AZ, run k6 at each milestone, managed IdP. |

**The app is now horizontally scalable.** It's stateless and containerized
(multi-stage `Dockerfile`, one image runs api/worker/migrate by command + `PROCESS_ROLE`),
and the three things that break a multi-instance deploy are fixed: rate limiting is
**Redis-backed** (one limit shared across replicas, verified: 11th auth request → 429,
counter stored in Redis), the pg pool is **bounded per instance** and fronted by
**PgBouncer** (transaction pooling) so replicas don't exhaust Postgres connections, and
Redis clients are **role-split + cloud-ready** (auth/TLS). `docker-compose.yml` runs the
full topology locally — `docker compose up --build --scale worker=3 --scale api=2`.

### The autoscaling milestone — ✅ built

Turning "designed for 100k" into demonstrable autoscaling (target: Kubernetes + HPA,
provable on `kind`/`minikube` at $0 — no live mega-cluster):

1. ✅ **Kubernetes manifests + HPA** (`k8s/`, Kustomize base + `overlays/{local,prod,loadtest}`).
   `api` + `worker` Deployments (same image, different command/`PROCESS_ROLE`), Service,
   Ingress, PDB, migration `Job` (direct-to-Postgres). **HPA** (autoscaling/v2) scales `api`
   on CPU; **KEDA** `ScaledObject` scales `worker` on **BullMQ queue depth** via a Prometheus
   query (`max(waiting)+max(delayed)`). Validated with `kustomize build` + `kubeconform`;
   CI (`manifests.yml`) adds a `kind` server-side dry-run.
2. ✅ **Prometheus `/metrics`** (`prom-client`) — HTTP histogram (route-template labels),
   default Node metrics, and the `drovery_queue_jobs{queue,state}` gauge the worker HPA
   scales on. (Grafana dashboards still to add.)
3. ✅ **k6 load test** (`load/`) — create→track→deliver, login-once-per-VU, smoke/ramp/
   throttle_proof scenarios; pairs with the `LOADTEST_BYPASS_THROTTLE` flag so a single-IP
   run can measure real throughput instead of the shared limiter.

✅ Sentry error tracking (see §10). ✅ Grafana dashboards and ✅ read replicas are now done
(§10 / §4). **Only remaining:** a real **cloud** multi-node cluster run for absolute scale-up
numbers — the local node-isolation harness + capacity model (§12) approximate it hardware-free.

**Phase 1's worker tier** — the delivery lifecycle lives in Redis/BullMQ instead of one
process's `setTimeout`s, with a **standalone worker** (`npm run worker`) that scales
independently of the API (`PROCESS_ROLE=api`). Verified: a delivery survives a backend
restart mid-flight, and an API-only instance enqueues without processing while a worker
drains the queue.
