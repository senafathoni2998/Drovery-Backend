# Drovery — Scaling Architecture (target: 100,000+ users)

This document is the plan to take Drovery from "works on one laptop" to **100k+ users**.
It is grounded in the current code: each section names the real blocker in this repo,
why it breaks at scale, and the concrete fix.

> TL;DR of the **hard blockers** (fix these first, in order):
> 1. **In-memory delivery simulation** (`setTimeout` in `SimulationService`) — kills horizontal scaling.
> 2. **Geocoding on the public Nominatim endpoint** — 1 req/sec policy = hard ceiling.
> 3. **In-process WebSocket/state** — doesn't survive multiple instances.
> 4. **Single Postgres, no pooling/replicas** — connection + read-load ceiling.

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

**Remaining for true multi-tier scale:** split the producer vs worker Redis connections (finite `maxRetriesPerRequest` + `enableOfflineQueue:false` on the producer so enqueues fail fast), add queue metrics/alerting, and — when real drones replace the simulation — have the same worker ingest telemetry from a drone-gateway/MQTT broker (the API and mobile contracts don't change).

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
- Next at very high fan-out: a dedicated realtime tier (so sockets scale independently of the API), per-client subscription reverse-index (O(1) disconnect), and tracking-snapshot caching (§2) to absorb the remaining polling.

## 4. 🔴 Database: pooling, indexes, replicas, partitioning

**Now:** single Postgres via a `pg` Pool per instance (`PrismaService`). At N instances × pool size, you exhaust Postgres connections fast.

**Fix (in order):**
- **PgBouncer** (transaction pooling) in front of Postgres; point Prisma at it. Essential once N instances > a handful.
- Indexes already exist on `Delivery(userId/status/trackingId)`, `Notification(userId,read)` — good. Add for new access patterns as they appear (e.g. `support_tickets(userId)` exists).
- **Read replicas** for the heavy read endpoints (lists, tracking polls, stats) — route reads via Prisma read-replica setup; writes to primary.
- **Hosted Postgres** with autoscaling storage/replicas (RDS/Aurora/Cloud SQL/Neon).
- Later, when `deliveries`/`delivery_tracking`/`notifications` grow huge, **partition by time** and archive/cold-store delivered rows.
- Make `trackingId` collision-safe: it's currently `uuid().slice(0,8)` (8 hex chars) — fine now, but add a unique-retry on insert (the column is `@unique`, so just retry on conflict) before volume makes collisions non-trivial.

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

## 10. Observability (you can't scale what you can't see)

- ✅ **Structured logging** (pino via `nestjs-pino`) with per-request correlation ids (`X-Request-Id`, propagated/echoed), auth header redaction, pretty in dev / JSON in prod. Ship the JSON to a log store.
- ✅ **Health probes**: `GET /health` (liveness) + `GET /health/ready` (DB + Redis, 503 when down) — public, un-throttled, k8s-ready.
- ✅ **Error tracking** (Sentry, `@sentry/node`) — unhandled 5xx reported from the global exception filter; DSN-gated (no-op without `SENTRY_DSN`); wired into both the API and worker entrypoints.
- ✅ **Metrics** (Prometheus, `prom-client`) — `GET /api/v1/metrics`: default Node/process metrics, an HTTP histogram + counter labelled by route **template** (cardinality-safe), and a `drovery_queue_jobs{queue,state}` gauge from BullMQ `getJobCounts()` (the signal the worker autoscaler scales on). The headless worker serves the same registry at `:9091/metrics`.
- **Remaining**: **tracing** API → worker → DB; Grafana dashboards + alerts on SLOs.

## 11. Delivery/CI & cost

- CI runs the test suites (already present, green) + lint + typecheck + `prisma migrate deploy` on deploy.
- Load-test (k6/Artillery) the create→track→deliver path before each scale milestone.
- Autoscale down off-peak; the worker/realtime tiers scale independently of the API.

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

✅ Sentry error tracking (see §10). **Next:** a real cluster run (KEDA + Prometheus +
metrics-server) to capture actual scale-up numbers, Grafana dashboards, and read replicas.

**Phase 1's worker tier** — the delivery lifecycle lives in Redis/BullMQ instead of one
process's `setTimeout`s, with a **standalone worker** (`npm run worker`) that scales
independently of the API (`PROCESS_ROLE=api`). Verified: a delivery survives a backend
restart mid-flight, and an API-only instance enqueues without processing while a worker
drains the queue.
