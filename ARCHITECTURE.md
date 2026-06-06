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

## 2. 🔴 Geocoding: replace public Nominatim + cache

**Now:** `GeoService` calls `nominatim.openstreetmap.org`, and we geocode **on every delivery create**.
Public Nominatim's usage policy is **~1 request/second** and bans heavy use — a hard ceiling far below 100k users, and a single point of failure.

**Fix:**
- Use a **commercial/self-hosted geocoder** (Google, Mapbox, or self-hosted Nominatim/Photon) behind the existing `GeoService` abstraction (`geocoding.provider` already exists in config).
- **Cache aggressively**: addresses repeat. Cache `address → {lat,lng}` in Redis (and/or a `geocode_cache` table) with a long TTL. This alone removes most calls.
- Make geocoding **async/non-blocking** for create latency: accept the delivery immediately, geocode in the worker, backfill coords. (Today it's awaited inline.)
- Prefer **client-supplied coordinates** from the map picker so the server rarely needs to geocode at all.

## 3. 🔴 Real-time tracking at scale (WS/SSE + Redis pub/sub)

**Now:** `TrackingGateway` holds subscriptions in an in-process `Map` and has **no WebSocket adapter installed**, so it doesn't actually serve. The mobile app currently **polls** `GET /deliveries/:id` every 4s (see `drovery-mobile`), which is correct and simple for launch.

**Scale path:**
- **Polling is fine to ~thousands of concurrent trackers** if you add caching (below). Keep it for launch.
- For true push at scale, stand up a **realtime tier** (Socket.IO with the **`@socket.io/redis-adapter`**, or SSE) so any instance can deliver an update. Workers publish position/status to **Redis Pub/Sub**; realtime nodes fan out to subscribed clients. This decouples "who computed the update" from "who holds the socket."
- Authenticate + **ownership-scope** every subscription (today the gateway is unauthenticated).

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
- **Validate config on boot**: `JWT_SECRET`/`JWT_REFRESH_SECRET` currently fall back to `change-me`. Wire `ConfigModule.forRoot({ validate })` to **refuse to boot** in prod without strong secrets.

## 7. Auth at scale

- Access tokens are stateless JWT (good — no per-request DB hit). Keep access tokens short (15m, already set).
- **Refresh-token store + rotation + revocation** (currently none, and logout is local-only): store hashed refresh tokens in Postgres/Redis so you can invalidate on logout/theft. Needed for security *and* so a compromised token isn't valid for 7 days.
- Consider moving auth to a managed IdP (Cognito/Auth0/Clerk) if you don't want to own this.

## 8. Push notifications at scale

- `NotificationsService.create()` now fans out to Expo Push (`exp.host`) per-user. At scale:
  - **Batch** Expo messages (100/request) and run sends in the **worker tier**, not inline on the request path.
  - Use **`expo-server-sdk`** for chunking + receipt handling; prune dead tokens (DeviceNotRegistered).
  - Rate-limit and retry with backoff.

## 9. Rate limiting, resilience, abuse control

- Add **`@nestjs/throttler`** (Redis-backed) — protect `auth/*`, `pricing/estimate`, `support/tickets`, geocoding.
- Timeouts + **circuit breakers** on outbound calls (geocoder, Expo, Stripe).
- Idempotency keys on `POST /deliveries` and payments to survive client retries.
- Fix CORS for web: `origin:'*'` + `credentials:true` is rejected by browsers — use an allowlist.

## 10. Observability (you can't scale what you can't see)

- **Structured logging** (pino) with request IDs; ship to a log store.
- **Metrics** (Prometheus/OpenTelemetry): p50/p95/p99 latency, error rate, queue depth/lag, DB pool saturation, push success rate.
- **Tracing** across API → worker → DB. **Error tracking** (Sentry). **Dashboards + alerts** on SLOs.

## 11. Delivery/CI & cost

- CI runs the test suites (already present, green) + lint + typecheck + `prisma migrate deploy` on deploy.
- Load-test (k6/Artillery) the create→track→deliver path before each scale milestone.
- Autoscale down off-peak; the worker/realtime tiers scale independently of the API.

---

## Phased rollout

| Phase | Users | Must-do |
|------|-------|---------|
| **0 — now** | <1k | Single API + Postgres + polling. Already works. Add config validation + rate limiting + Sentry. |
| **1** | ~10k | ✅ **BullMQ worker tier** (simulation on Redis jobs + **standalone `worker` process** + `PROCESS_ROLE` split — done). Remaining: **PgBouncer**, **Redis cache** (geocode + tracking snapshot), commercial geocoder, refresh-token revocation, producer/worker Redis connection split. |
| **2** | ~50k | Multiple API instances + autoscaling, **read replicas**, batched Expo push in worker, structured logging + metrics/alerts. |
| **3** | 100k+ | **Realtime tier** (Socket.IO + Redis adapter) replacing polling, partition/archive old rows, multi-AZ, load-test each milestone, consider managed IdP. |

**Phase 1's worker tier is in place** — the delivery lifecycle lives in Redis/BullMQ
instead of one process's `setTimeout`s, with a **standalone worker process** (`npm run worker`)
that scales independently of the API (`PROCESS_ROLE=api`). Verified: a delivery survives a
backend restart mid-flight, and an API-only instance enqueues without processing while a
worker drains the queue. The next levers are the **Redis cache** (geocoding is the next hard
ceiling) and **PgBouncer + read replicas**.
