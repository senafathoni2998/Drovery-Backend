# Drovery Backend

[![CI](https://github.com/senafathoni2998/Drovery-Backend/actions/workflows/ci.yml/badge.svg)](https://github.com/senafathoni2998/Drovery-Backend/actions/workflows/ci.yml)
[![Publish image](https://github.com/senafathoni2998/Drovery-Backend/actions/workflows/publish.yml/badge.svg)](https://github.com/senafathoni2998/Drovery-Backend/actions/workflows/publish.yml)

> Drone-delivery platform API — one real-time tracking core, two producers (simulated + live drone telemetry), and a durable delivery lifecycle on BullMQ. Architected toward 100k+ users with env-gated scaling seams.

Drovery is a portfolio/demo of an autonomous drone-delivery platform: customers book a delivery and watch a drone fly their package in real time, operators oversee the fleet from an admin console, and the backend runs the drone simulation and the durable delivery lifecycle. This repo is the brain — a [NestJS](https://nestjs.com) 11 API on [Prisma](https://prisma.io) 7, PostgreSQL, and Redis/BullMQ.

**Part of the Drovery system** (personal project by Sena Fathoni):

| Repository | Role | Stack |
|---|---|---|
| **Drovery_Backend** (this repo) | API · realtime · background workers · drone sim | NestJS 11 · Prisma 7 · PostgreSQL 16 · Redis/BullMQ |
| [Drovery_Mobile](https://github.com/senafathoni2998/Drovery-Mobile) | customer app | Expo / React Native · TypeScript |
| [Drovery_Admin](https://github.com/senafathoni2998/Drovery-Admin-Frontend) | operator & support console | Vite · React 19 · MUI 7 · Redux Toolkit |

Live demo — API: <https://droverybackend.senafathoni.dev> · Admin: <https://droverydashboard.senafathoni.dev>

> **Scaling honesty:** Drovery ships additive, env-gated scaling seams (see [`SCALING-1M.md`](SCALING-1M.md)) and runs clean under a small proportional load harness. The capacity numbers in the scaling docs are explicitly *illustrative projections* — the system is **architected** toward 100k→1M but has **not been load-validated** at those scales, and the horizontal sharding (`ShardRouter`) is designed, not built. Treat it as a well-engineered foundation, not a proven 1M-concurrent deployment.

## Features

- **Live drone tracking** over WebSockets, with Redis pub/sub fan-out across API replicas.
- **Dual tracking sources:** `SIMULATED` (in-memory sim, moved by the BullMQ worker) and `LIVE` (real drone telemetry ingested over HTTP or MQTT).
- **Durable delivery lifecycle** on a BullMQ job queue with a separate, stateless worker tier.
- **Stuck-delivery watchdog** that reaps LIVE deliveries after telemetry silence and triggers a refund.
- **Bidirectional drone commands** — admin issues `RETURN_TO_BASE` / `ABORT`; the drone polls and acks (the ack is the sole CAS trigger).
- **Recurring deliveries** (`DAILY` / `WEEKLY` auto-materialization).
- **Payments:** Stripe + wallet credits + promo codes + referral rewards (atomic with delivery create).
- **Geo-serviceability** (geofencing) + weather safety checks before flight.
- **Proof of delivery** with photos + delivery ratings.
- **Real-time support chat** over WebSockets, plus an operator admin console (delivery/fleet management).
- **Optimistic locking (CAS)** on all mutations — collision-retry on `trackingId`, watchdog reap, and commands.
- **PostgreSQL RANGE partitioning** (deliveries, notifications, workflow steps, drone commands) with self-discovering plpgsql auto-maintenance — no `pg_partman` / `pg_cron`.
- **Connection pooling** (PgBouncer) + optional, env-gated **read replicas** with fail-safe fallback to primary.
- **Observability:** OpenTelemetry distributed tracing (API → queue → worker → DB on a shared `traceId`), Prometheus metrics + Grafana dashboards + SLO alerts as code, Sentry error tracking, structured `pino` logging with correlation IDs.
- **i18n** (en/id) + email + Expo Push notifications.
- **One Docker image, four tiers** via `PROCESS_ROLE`: `api` (HTTP + ingest), `worker` (headless sim/jobs), `realtime` (sockets-only), and dev (all-in-one).

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js `>=22.12.0` (required by Prisma 7) |
| Framework | NestJS 11.0 |
| ORM / DB | Prisma 7.5 · PostgreSQL 16 |
| Queue / cache / pub-sub | Redis · BullMQ 5.78 |
| Language | TypeScript 5.7 |

## Quick start

### Prerequisites

- Node.js `>=22.12.0` and npm `>=10`
- PostgreSQL `>=15` and Redis `>=6` — both **required** (Redis powers BullMQ, cache, pub/sub, and rate-limiting; the app will not boot without it)
- Docker (optional, to run PostgreSQL/Redis without a local install)

### Install & configure

```bash
git clone https://github.com/senafathoni2998/Drovery-Backend.git
cd Drovery-Backend
npm install
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, REDIS_HOST/PORT
```

Start PostgreSQL and Redis (locally or via Docker), then apply the schema and seed demo data:

```bash
npm run prisma:migrate   # apply migrations (migrations only — see note below)
npm run prisma:seed      # demo user + 6 deliveries + 2 payment methods
```

> **Prisma migrations only.** The partitioned tables use composite primary keys, so `prisma db push` / `db pull` are **forbidden** here — always go through migrations. Drift is gated in CI via `npm run prisma:drift-check`. See [`prisma/PARTITIONING.md`](prisma/PARTITIONING.md).

### Run

```bash
npm run start:dev                          # dev (all-in-one: HTTP + worker + sockets)
# or production:
npm run build && npm run start:prod        # API tier
```

To run the **worker tier** that moves drones (BullMQ drone simulation), start it as a separate process:

```bash
npm run worker        # dev (watch mode)
npm run worker:prod   # compiled, no HTTP
```

> If simulated drones aren't moving, it's almost always because no worker tier is running. Use the all-in-one dev mode or start a `worker`.

### Verify

```bash
curl http://localhost:3000/api/v1/support/faqs
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@drovery.com","password":"demo123"}'
```

Interactive API docs (Swagger) are served at <http://localhost:3000/api/v1/docs>.

## Configuration

Full reference (with safe defaults) lives in [`.env.example`](.env.example). Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (**required**) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Access / refresh token secrets (**required**; production refuses weak values) |
| `REDIS_HOST` / `REDIS_PORT` | Redis broker (**required**; defaults `localhost:6379`) |
| `PROCESS_ROLE` | `api` · `worker` · `realtime` · unset (dev all-in-one) |
| `DATABASE_REPLICA_URL` | Optional read replica; lag-tolerant reads route here, writes + CAS stay on primary |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Real Stripe payments (optional) |
| `ALLOW_MOCK_PAYMENTS` | `true` to boot without Stripe keys (demo mode; webhook stays fail-closed) |
| `SERVICE_AREA_GLOBAL` | `true` to allow deliveries anywhere (default: geofenced to Greater Jakarta + Bandung) |
| `INGEST_API_KEY` | Shared key for `POST /ingest/telemetry` (fail-closed: unset = endpoint disabled) |
| `MQTT_URL` | Enable MQTT telemetry/command transport (unset = HTTP ingest only) |
| `WATCHDOG_ENABLED` | Stuck-delivery reaper (default `true`); `WATCHDOG_SILENCE_MS` sets the silence threshold (default 10m) |
| `PARTITION_MAINTENANCE_ENABLED` | RANGE-partition auto-provisioning / draining (default `true`) |
| `METRICS_ENABLED` | Prometheus metrics at `GET /api/v1/metrics` (default `true`) |
| `TRACING_ENABLED` | OpenTelemetry tracing (OFF by default, zero overhead) |
| `SENTRY_DSN` | Sentry error tracking (unset = no-op) |
| `CORS_ORIGINS` | Comma-separated browser allowlist (unset = wildcard, no credentials) |

**Demo flags** (handy for trying things out without external accounts): `SERVICE_AREA_GLOBAL=true` makes everywhere serviceable, and `ALLOW_MOCK_PAYMENTS=true` runs keyless Stripe (payments confirm at creation; the webhook still fails closed).

## Project structure

```
src/
  main.ts              API entry (HTTP + ingest)
  worker.ts            BullMQ queue consumer (drone sim + jobs)
  app.module.ts        31 feature modules wired here
  auth/                JWT login/signup/refresh, password reset, email verification
  deliveries/          CRUD, create (promo/referral/wallet ledger), tracking, sim, telemetry ingest
  delivery-watchdog/   stuck-delivery reaper (telemetry silence -> refund)
  partition-maintenance/  RANGE partition provisioning + draining + retention
  payments/ stripe/    Stripe payment methods, intents, webhooks
  wallet/ promo/       credit ledger (debit-first saga) + promo redemption
  recurring-deliveries/   DAILY/WEEKLY auto-materialization
  notifications/       device registration, Expo push, preferences, quiet hours
  geo/ serviceability/ geocoding (Nominatim/Google) + geofence + weather checks
  support/             FAQs, tickets, WebSocket chat gateway (Redis pub/sub)
  workflows/ admin/    delivery workflow steps + operator console API
  mqtt/ outbox/        optional MQTT transport · transactional outbox (Phase-3)
  metrics/ health/     Prometheus registry · liveness/readiness probes
  cache/ i18n/ mail/ storage/   Redis cache · en/id localization · email · uploads
  common/              guards, filters, interceptors, correlation IDs, OTel, process-role
prisma/                schema.prisma (27 models), migrations/, seed.ts, PARTITIONING.md
k8s/                   Deployment, Service, HPA, KEDA, ServiceMonitor + alerts
observability/         Prometheus config, Grafana dashboards, SLO alerts (as code)
loadtest/              capacity model + load harness (CAPACITY-MODEL.md)
deploy/                Caddyfile + VPS deploy assets
docker-compose*.yml    full stack + prod / observability / loadtest / nodes overlays
```

## Testing

```bash
npm run test        # unit tests (Jest + ts-jest) — 80 spec files, 720+ tests
npm run test:e2e    # end-to-end tests (test/jest-e2e.json)
npm run test:cov    # coverage report -> coverage/
```

CI runs: install → `prisma generate` → `prisma migrate deploy` (against live Postgres) → build → tests → Docker build validation, plus `npm run prisma:drift-check` to guard the partitioned schema. The test suite is byte-identical with OpenTelemetry tracing disabled (the default), and read-replica mode is byte-identical with `DATABASE_REPLICA_URL` unset.

## Deployment

See [`DEPLOY.md`](DEPLOY.md) for the full VPS + Docker Compose + Caddy runbook. In short:

- **Docker Compose (single VPS):** `docker-compose.yml` + `docker-compose.prod.yml` bring up the full stack (LB, API ×N, worker ×M, PgBouncer, PostgreSQL, Redis, MQTT, optional observability). One image, role chosen by `PROCESS_ROLE`. Scale with `--scale api=2 --scale worker=3`.
- **Kubernetes:** `k8s/` ships stateless API/worker Deployments, Services, an HPA (CPU-based API scaling), KEDA (queue-depth worker scaling), and ServiceMonitor + PrometheusRule.
- **Migrations in prod:** use `npx prisma migrate deploy` (non-interactive), never `migrate dev`.
- **Scaling notes:** PgBouncer (transaction pooling) is essential past a handful of instances; read replicas are optional and fail back to primary on a blip (logged, never a 5xx). Redis is required at boot — BullMQ and the shared rate-limiter have no fallback.
- **Secrets:** never commit a production `.env`; use your platform's secrets manager. See `.env.prod.example` for the strong-secret validation gate.

## Scripts

| Script | Description |
|---|---|
| `start` / `start:dev` / `start:prod` | Run API (plain / hot-reload / compiled) |
| `worker` / `worker:prod` | Run the BullMQ queue worker (watch / compiled, no HTTP) |
| `build` | Compile TypeScript to `dist/` |
| `test` / `test:watch` / `test:e2e` / `test:cov` | Unit / watch / e2e / coverage |
| `lint` / `format` | ESLint (auto-fix) / Prettier |
| `prisma:generate` | Regenerate Prisma Client |
| `prisma:migrate` | Run migrations (dev mode) |
| `prisma:studio` | Open Prisma Studio GUI |
| `prisma:seed` | Seed demo data (`demo@drovery.com` / `demo123`) |
| `db:reset` | Reset DB and re-run all migrations |
| `prisma:drift-check` | Detect schema drift in CI (partitioning safeguard) |

## Further reading

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system design and data flow
- [`SCALING-1M.md`](SCALING-1M.md) — the three hard ceilings and the env-gated seams
- [`prisma/PARTITIONING.md`](prisma/PARTITIONING.md) — partitioning runbook
- [`INTEGRATION.md`](INTEGRATION.md) — how the mobile and admin apps talk to this API
