# Load testing

A reproducible, **fully containerized** load test of the scalable topology — no host installs
(k6 runs as a container). It exercises every tier the architecture scales (API replicas →
PgBouncer → Postgres, and the BullMQ queue → worker replicas) and lets you watch the same
signals the production alerts fire on.

## Topology under test

```
k6 ──▶ nginx LB ──▶ api ×N  ─┐
        (8088)               ├─ PgBouncer ─▶ Postgres
   BullMQ queue ─▶ worker ×M ┘        │
        api + worker ─▶ Redis  (queue + cache + rate-limit)
```

`docker-compose.loadtest.yml` overlays the base stack to (1) front the scaled `api` replicas
with an nginx round-robin LB (the base binds api to a host port, which can't be shared across
replicas — the overlay `!reset`s it), and (2) add the k6 runner. The API runs in a **non-prod
env with `LOADTEST_BYPASS_THROTTLE=true`** so the per-IP rate limiter doesn't cap all k6
traffic (one source IP) to the throttle limit and **mask horizontal scaling**
(`LoadTestThrottlerGuard` hard-disables the bypass when `NODE_ENV=production`).

## Run it

Prereq: Docker daemon access (be in the `docker` group — `sudo usermod -aG docker $USER`
then re-login — or prefix the commands with `sudo`). `docker compose config` validates the
files without the daemon; `up`/`build`/`run` need it.

**One command** (builds, scales, waits for the LB to be healthy, fires k6, all guarded):

```bash
sudo bash loadtest/run.sh                                   # api=3 worker=3 VUS=50 HOLD=90s
sudo API=5 WORKER=5 VUS=100 HOLD=120s bash loadtest/run.sh  # heavier
sudo bash loadtest/down.sh                                  # tear down + wipe volumes
```

Or the steps by hand:

```bash
# 1. Build + start the scaled stack (detached).
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d \
  --build --scale api=3 --scale worker=3

# 2. Fire the load. Use --no-deps so `run` doesn't reconcile (and silently rescale to 1)
#    the already-up api/worker — they're held at scale 3 by the `up` above.
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml \
  run --rm --no-deps -e VUS=50 -e HOLD=120s k6

# 3. Tear down (and wipe the volumes).
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml down -v
```

Knobs: `VUS` (peak virtual users), `RAMP`, `HOLD`, `BASE_URL`, `LB_PORT` (host port for the
ad-hoc LB — default 8088).

## The journey (per virtual user)

`loadtest/scenario.js`: **signup** (DB write + JWT) → **create delivery** (write + payment +
BullMQ enqueue, which fans lifecycle jobs to the **worker** tier) → **list deliveries** (read)
→ **poll one** (read). Coordinates are inside Greater Bandung so `assertServiceable` passes and
the geocoder is skipped (we load-test Drovery, not nominatim). Thresholds (tuned for a single
local box, where everything shares one machine — tighten for cloud):

| metric | threshold |
|---|---|
| `http_req_failed` | `< 2%` |
| `http_req_duration` p95 | `< 1500 ms` |
| `checks` pass rate | `> 98%` |

Per-step Trends (`step_signup`, `step_create_delivery`, `step_list`, `step_get_one`) isolate
which tier a regression is in.

## What to watch (it ties into the observability stack)

Bring up Prometheus + Grafana alongside (`docker-compose.observability.yml`) and watch the
metrics the SLO alerts use (`observability/alerts.yml`):

- **`drovery_queue_jobs{state="waiting"|"delayed"}`** — the KEDA scale signal. Under load it
  rises, then drains as the workers keep up; if it climbs unbounded, add `--scale worker`.
- **`drovery_http_request_duration_seconds` p99** by route — the latency SLO.
- **`drovery_http_requests_total{status=~"5.."}`** — the error-rate SLO (should stay ~0).
- **`drovery_partition_*`** — the partitions stay healthy (default-rows ~0) as the write
  volume lands in the current month's `deliveries`/`notifications` children.

## Demonstrates

- Horizontal API scaling behind the LB (raise `--scale api`, throughput rises ~linearly until
  a shared tier — PgBouncer pool / Postgres / the box — saturates).
- The **worker split**: creates enqueue; the worker tier drains the queue independently
  (`--scale worker` controls drain rate, visible as the backlog gauge).
- **PgBouncer** multiplexing many app clients onto a small Postgres pool (the API/worker
  `DATABASE_POOL_MAX` × replicas stays well under Postgres `max_connections`).

> Real 100k-scale numbers need real (multi-node, cloud) infra — this harness proves the
> design holds and the signals fire; the absolute numbers are bounded by the single box.
