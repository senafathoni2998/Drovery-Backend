# Drovery Backend

A drone delivery platform API built with [NestJS](https://nestjs.com), [Prisma](https://prisma.io), and PostgreSQL.

## Drovery — system overview

Drovery is a full-stack drone-delivery platform: customers book and **watch a drone fly their
package in real time**, operators oversee the fleet, and the system is engineered — and
measured — for **100k+ users**. It spans three repositories:

| Repository | Role | Stack | Scale |
|---|---|---|---|
| **drovery-backend** (this repo) | API · realtime · background workers | NestJS 11 · Prisma 7 · PostgreSQL 16 · Redis/BullMQ | 28 modules · 96 endpoints · 25 models · 610 tests |
| [**drovery-mobile**](https://github.com/senafathoni2998/drovery-mobile) | customer app | Expo / React Native 0.81 · TypeScript | live tracking · handoff OTP · 280 tests |
| [**drovery-admin**](https://github.com/senafathoni2998/Drovery-Admin-Frontend) | operator & support console | Vite · React 19 · MUI 7 · Redux Toolkit | 5 sections · live support · 65 tests · CI |

```
  Mobile (Expo/RN) ─┐                              ┌─► PgBouncer ─► PostgreSQL (primary + read replicas)
  Admin (React/MUI) ┼─► nginx LB ─► API ×N ────────┤        RANGE-partitioned hot tables (notifications,
  Drone (HTTP/MQTT) ┘   (stateless)  │  WS gateways │        deliveries + graph) · CI drift gate
                                     │              └─► Redis  (queue · cache · pub/sub · rate-limit)
                                     └─► Worker ×M ──┘  lifecycle · watchdog · partition maint · push
   one image, role = PROCESS_ROLE        (BullMQ)       HPA scales api on CPU · KEDA scales worker on queue depth
```

### Engineering highlights

- **One tracking core, two producers.** A delivery is `SIMULATED` or `LIVE`; both drive the
  *same* monotonic compare-and-set tracking pipeline — so a real drone is just another
  producer over `POST /ingest/telemetry` (or MQTT). The whole live path is demoable with **no
  hardware**, and a self-healing **watchdog** reaps a drone that goes silent.
- **Stateless + horizontally scalable.** The delivery lifecycle runs as durable BullMQ jobs
  on a separate worker tier (survives restarts); real-time **tracking + support chat** scale
  across replicas over WebSockets + Redis pub/sub (worker publishes, any API node fans out).
- **PostgreSQL RANGE partitioning** of the hot tables — `notifications` *and* the full delivery
  graph (`deliveries` + 8 children) — with **no `pg_partman`/`pg_cron`**: self-discovering
  plpgsql maintenance + retention, composite-FK fan-out solved, drift gated in CI.
- **Operated like production:** PgBouncer pooling · env-gated read replicas · K8s + HPA/KEDA ·
  OpenTelemetry tracing (one `traceId` across api→queue→worker→DB) · Prometheus + Grafana +
  SLO alerts (as code) · Sentry · OpenAPI/Swagger · bidirectional drone commands · en/id i18n.

### Built for scale — and measured

A containerized cluster (`docker compose` → nginx LB over scaled api/worker → PgBouncer →
Postgres) plus a [capacity model](./loadtest/CAPACITY-MODEL.md) turn "designed for 100k" into
numbers: a 50-VU run drove **4,344 requests with 0 failures / 100% checks**, the per-node
sweep showed throughput scaling (api 1→2→3 ≈ 45→78→84 req/s until a shared tier knees), and the
model projects **1 api + 1 worker node serve 100k DAU at the SLO** — the PgBouncer connection
budget (~95 api nodes) is the eventual ceiling. The lone latency wall is cost-12 bcrypt on
signup — the textbook CPU-bound case horizontal scaling fixes.

> **Deeper dives:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the 100k scaling design, section by
> section) · [`INTEGRATION.md`](./INTEGRATION.md) (mobile↔backend contract) ·
> [`loadtest/`](./loadtest) (the cluster harness + capacity model) ·
> [`prisma/PARTITIONING.md`](./prisma/PARTITIONING.md) (the partitioning runbook).

---

> **Companion app:** this API is consumed by the **drovery-mobile** Expo / React Native app (sibling repo at `../drovery-mobile`). For the full mobile↔backend contract — endpoint map, auth/token lifecycle, response envelope, and how to point the app at this server — see **[INTEGRATION.md](./INTEGRATION.md)**.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [1. Clone the Repository](#1-clone-the-repository)
- [2. Install Dependencies](#2-install-dependencies)
- [3. Set Up Environment Variables](#3-set-up-environment-variables)
- [4. Set Up PostgreSQL Database](#4-set-up-postgresql-database)
- [5. Run Prisma Migrations](#5-run-prisma-migrations)
- [6. Seed the Database](#6-seed-the-database)
- [7. Run the Server](#7-run-the-server)
- [8. Verify the Setup](#8-verify-the-setup)
- [Project Structure](#project-structure)
- [API Modules](#api-modules)
- [Available Scripts](#available-scripts)
- [9. Build for Production](#9-build-for-production)
- [Common Issues](#common-issues)

---

## Prerequisites

Make sure the following are installed on your machine before starting:

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org) | >= 20.x | Use [nvm](https://github.com/nvm-sh/nvm) to manage versions |
| [npm](https://npmjs.com) | >= 10.x | Comes bundled with Node.js |
| [PostgreSQL](https://postgresql.org) | >= 15.x | Running locally or via Docker |
| [Redis](https://redis.io) | >= 6.x | **Required** — backs the BullMQ delivery-simulation queue (`REDIS_HOST`/`REDIS_PORT`). e.g. `redis-server --port 6379` |
| [Git](https://git-scm.com) | any | To clone the repo |

**Optional but recommended:**
- [Docker](https://docker.com) — for running PostgreSQL without a local install
- [Prisma Studio](https://prisma.io/studio) — GUI to browse/edit the database (included via `npm run prisma:studio`)

---

## 1. Clone the Repository

```bash
git clone <your-repo-url>
cd drovery-backend
```

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Set Up Environment Variables

Create a `.env` file in the project root by copying the example below:

```bash
cp .env.example .env   # if the example file exists, otherwise create it manually
```

Then fill in the values:

```env
# Server
PORT=3000
API_PREFIX=api/v1

# Database — PostgreSQL connection string
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/drovery_db"

# JWT — change these secrets in production!
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key
JWT_REFRESH_EXPIRES_IN=7d

# Stripe (optional — leave empty to skip payment flows)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Google Maps (optional — falls back to Nominatim/OpenStreetMap)
GEOCODING_PROVIDER=nominatim
GOOGLE_MAPS_API_KEY=

# Expo Push Notifications (optional)
EXPO_ACCESS_TOKEN=
```

> **Required at startup:** `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.
> The app will throw a validation error on boot if any of these are missing.

---

## 4. Set Up PostgreSQL Database

### Option A — Using Docker (recommended)

```bash
docker run --name drovery-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=drovery_db \
  -p 5432:5432 \
  -d postgres:15
```

Your `DATABASE_URL` for this setup:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/drovery_db"
```

### Option B — Using a Local PostgreSQL Install

1. Open a PostgreSQL shell:

```bash
psql -U postgres
```

2. Create the database and a dedicated user:

```sql
CREATE USER drovery_user WITH PASSWORD 'yourpassword';
CREATE DATABASE drovery_db OWNER drovery_user;
GRANT ALL PRIVILEGES ON DATABASE drovery_db TO drovery_user;
\q
```

3. Update your `.env`:

```env
DATABASE_URL="postgresql://drovery_user:yourpassword@localhost:5432/drovery_db"
```

---

## 5. Run Prisma Migrations

Prisma manages the database schema. Run the migration to create all tables:

```bash
npm run prisma:migrate
```

This command will:
- Apply all SQL migrations from `prisma/migrations/`
- Generate the Prisma Client used by the app

If you change `prisma/schema.prisma` later, create a new migration with:

```bash
npx prisma migrate dev --name describe_your_change
```

To regenerate the Prisma Client without running migrations (e.g., after a `git pull`):

```bash
npm run prisma:generate
```

To inspect the database visually in your browser:

```bash
npm run prisma:studio
```

---

## 6. Seed the Database

Populate the database with a demo user and sample deliveries:

```bash
npm run prisma:seed
```

This creates:

| Resource | Details |
|----------|---------|
| **Demo user** | `demo@drovery.com` / password: `demo123` |
| **6 deliveries** | Various statuses: `IN_TRANSIT`, `PICKUP_IN_PROGRESS`, `DELIVERED`, `CANCELED` |
| **2 payment methods** | Mock Visa (`4242`) and Mastercard (`5353`) |

---

## 7. Run the Server

### Development mode (with hot reload)

```bash
npm run start:dev
```

### Standard mode

```bash
npm run start
```

### Production mode

```bash
npm run build
npm run start:prod
```

Once running, the API is available at:

```
http://localhost:3000/api/v1
```

---

## 8. Verify the Setup

Test that the server is running by hitting a public endpoint:

```bash
curl http://localhost:3000/api/v1/support/faqs
```

You should receive a JSON response with FAQ data.

To log in as the demo user and get a token:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@drovery.com", "password": "demo123"}'
```

Use the returned `accessToken` as a Bearer token on protected routes:

```bash
curl http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer <accessToken>"
```

---

## Project Structure

```
drovery-backend/
├── prisma/
│   ├── schema.prisma        # Database schema (models & relations)
│   ├── prisma.config.ts     # Prisma configuration
│   ├── seed.ts              # Database seed script
│   └── migrations/          # Auto-generated SQL migration files
├── src/
│   ├── app.module.ts        # Root module — wires everything together
│   ├── main.ts              # Entry point — bootstraps the NestJS app
│   ├── config/
│   │   ├── configuration.ts # Maps env vars to typed config object
│   │   └── validation.ts    # Validates required env vars on startup
│   ├── prisma/              # Prisma service & module (database access)
│   ├── common/
│   │   ├── decorators/      # @CurrentUser(), @Public()
│   │   ├── filters/         # Global exception filter
│   │   ├── guards/          # JWT auth guard (applied globally)
│   │   ├── interceptors/    # Response transform interceptor
│   │   └── dto/             # Shared DTOs (e.g., pagination)
│   ├── auth/                # Registration, login, token refresh
│   ├── users/               # User profile management
│   ├── deliveries/          # Delivery CRUD, tracking, simulation
│   ├── pricing/             # Price estimation
│   ├── payments/            # Payment methods
│   ├── notifications/       # Push notification device registration
│   ├── geo/                 # Geocoding & address lookup
│   ├── workflows/           # Delivery workflow step management
│   └── support/             # FAQs & support content
└── test/                    # End-to-end tests
```

---

## API Modules

All routes are prefixed with `/api/v1`. Routes marked **Public** do not require authentication.

| Module | Base Path | Key Endpoints |
|--------|-----------|--------------|
| **Auth** | `/auth` | `POST /signup` (Public), `POST /login` (Public), `POST /refresh` (Public) |
| **Users** | `/users` | `GET /me`, `PATCH /me`, `DELETE /me` |
| **Deliveries** | `/deliveries` | `GET /`, `POST /`, `GET /:id`, `PATCH /:id/status` |
| **Tracking** | `/deliveries/:id/tracking` | `GET` (REST) + WebSocket gateway |
| **Pricing** | `/pricing` | `POST /estimate` (Public) |
| **Payments** | `/payments` | `GET /methods`, `POST /methods`, `DELETE /methods/:id` |
| **Notifications** | `/notifications` | `POST /devices`, `GET /`, `PATCH /:id/read` |
| **Geo** | `/geo` | `GET /geocode`, `GET /reverse` |
| **Workflows** | `/workflows` | `GET /:type`, `POST /:deliveryId/steps` |
| **Support** | `/support` | `GET /faqs` (Public) |

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run start` | Start the server |
| `npm run start:dev` | Start with hot reload (development) |
| `npm run start:prod` | Start compiled production build (API) |
| `npm run worker` | Start the BullMQ queue worker (dev, watch) |
| `npm run worker:prod` | Start the compiled queue worker (no HTTP) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Lint and auto-fix source files |
| `npm run format` | Format files with Prettier |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:cov` | Run tests with coverage report |
| `npm run prisma:migrate` | Apply database migrations |
| `npm run prisma:generate` | Regenerate Prisma Client |
| `npm run prisma:studio` | Open Prisma Studio (database GUI) |
| `npm run prisma:seed` | Seed the database with demo data |
| `npm run db:reset` | Reset the database and re-run all migrations |

---

## 9. Build for Production

### Why you need a build step

NestJS is written in TypeScript. Node.js cannot run TypeScript directly, so the source code must be compiled to plain JavaScript before deploying. The build output lives in the `dist/` folder.

| Mode | How it runs TypeScript | Use for |
|------|----------------------|---------|
| `start:dev` | Compiled in-memory on every file change | Local development only |
| `start:prod` | Runs pre-compiled `dist/src/main.js` | Production (API) |
| `worker` / `worker:prod` | Runs the BullMQ queue consumer (no HTTP) | Production (worker tier) |

---

### Step 1 — Set environment variables

On the production server, set the same variables from your `.env` file as real environment variables. Never copy a `.env` file to a production server — set them via your hosting platform, CI/CD secrets, or a secrets manager.

```bash
export PORT=3000
export DATABASE_URL="postgresql://user:password@host:5432/drovery_db"
export JWT_SECRET="a-long-random-secret"
export JWT_REFRESH_SECRET="another-long-random-secret"
```

---

### Step 2 — Install only production dependencies

```bash
npm ci --omit=dev
```

`--omit=dev` skips dev tools like Jest, ESLint, and ts-node that are not needed at runtime.

---

### Step 3 — Generate the Prisma Client

The Prisma Client must be generated in the production environment since it is platform-specific:

```bash
npm run prisma:generate
```

---

### Step 4 — Run database migrations

Apply any pending schema migrations against the production database:

```bash
npm run prisma:migrate
```

> On production you may prefer `npx prisma migrate deploy` instead of `prisma migrate dev` — it applies existing migrations without creating new ones or prompting for input.

```bash
npx prisma migrate deploy
```

---

### Step 5 — Build the app

```bash
npm run build
```

This compiles all TypeScript from `src/` into JavaScript in `dist/`. You only need to do this once per deployment.

---

### Step 6 — Start the server

```bash
npm run start:prod
```

This runs `node dist/src/main` directly — no TypeScript compiler involved, minimal memory usage, fast startup.

> **Worker tier.** The delivery simulation runs on a Redis/BullMQ queue. By default the API process also consumes jobs (single-process). To scale, run dedicated workers and tell the API not to consume:
> ```bash
> # API instances (enqueue only)
> PROCESS_ROLE=api npm run start:prod
> # one or more worker instances (consume jobs; no HTTP)
> npm run worker:prod
> ```
> `SIM_WORKER_CONCURRENCY` (default 10) tunes per-worker parallelism. **Redis must be running** for either to boot.

---

### Full production sequence (copy-paste)

```bash
npm ci --omit=dev
npm run prisma:generate
npx prisma migrate deploy
npm run build
npm run start:prod
```

---

### Keeping the server alive with PM2

In production you want the process to restart automatically if it crashes. [PM2](https://pm2.keymetrics.io) is the standard tool for this.

**Install PM2:**

```bash
npm install -g pm2
```

**Start the app with PM2:**

```bash
pm2 start dist/src/main.js --name drovery-api
# and a worker process (queue consumer):
pm2 start dist/src/worker.js --name drovery-worker
```

**Useful PM2 commands:**

```bash
pm2 list                  # show running processes
pm2 logs drovery-api      # stream logs
pm2 restart drovery-api   # restart the process
pm2 stop drovery-api      # stop the process
pm2 startup               # auto-start PM2 on server reboot
pm2 save                  # save current process list for startup
```

---

### Docker (full stack)

A production multi-stage `Dockerfile` and a `docker-compose.yml` for the whole
topology ship with the repo. One image runs any role (api / worker / migrate) —
the role is chosen by the command + `PROCESS_ROLE`.

```bash
# Build + run the full stack: postgres + pgbouncer + redis + migrate + api + worker
docker compose up --build

# Scale the API and worker tiers independently (they're stateless)
docker compose up --build --scale api=2 --scale worker=3
```

The compose stack demonstrates the production scaling topology:
- **api** (`PROCESS_ROLE=api`) — enqueue-only, never processes jobs.
- **worker** — drains the BullMQ queue; scales separately from the API.
- **pgbouncer** — transaction-pooling tier in front of Postgres, so the API/worker
  tiers can scale out without exhausting Postgres `max_connections`.
- **redis** — queue + cache + the shared rate-limit counter (so the limit holds
  across every API replica, not per-instance).
- **migrate** — one-shot `prisma migrate deploy` + seed (runs directly against
  Postgres, bypassing the pooler), then exits.

> The api/worker boot in `NODE_ENV=production` to exercise the real prod path
> (JSON logs + the weak-secret boot guard). The JWT secrets in `docker-compose.yml`
> are strong-enough-to-boot **local** values — never reuse them anywhere real.

Build just the image:

```bash
docker build -t drovery-api .
docker run -p 3000:3000 --env-file .env drovery-api
```

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every PR:
**install → prisma generate → migrate deploy (against a live Postgres) → build
→ unit tests**, plus a job that **builds the Docker image** to validate the
Dockerfile. Lint runs as a non-blocking step pending the `no-unsafe-any` cleanup.

---

## Common Issues

**App fails to start with a validation error**
> One of the required env vars (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT`) is missing from `.env`. Double-check the file exists and is in the project root.

**`ECONNREFUSED` connecting to PostgreSQL**
> The database is not running. Start it with Docker (`docker start drovery-postgres`) or ensure your local PostgreSQL service is active.

**`P1001: Can't reach database server`**
> Your `DATABASE_URL` credentials or host/port are wrong. Verify the connection string matches your database setup.

**Prisma Client is out of date**
> After pulling changes that include schema updates, always run `npm run prisma:generate` (or `npm run prisma:migrate` if new migrations were added).

**Port already in use**
> Change `PORT` in your `.env`, or kill the process occupying port 3000:
> ```bash
> lsof -ti:3000 | xargs kill
> ```
