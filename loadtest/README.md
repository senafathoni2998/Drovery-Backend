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

**One command** (builds, scales, waits for the LB to be healthy, fires k6, measures the
worker drain, all guarded):

```bash
sudo bash loadtest/run.sh                                    # auth journey, api=3 worker=3
sudo NODES=1 bash loadtest/run.sh                            # + bound each replica (real "nodes")
sudo NODES=1 SCENARIO=io   VUS=100 bash loadtest/run.sh      # pure-I/O ceiling (auth amortized)
sudo NODES=1 SCENARIO=read VUS=200 bash loadtest/run.sh      # read-only ceiling
sudo bash loadtest/sweep.sh                                  # horizontal-scaling curve (api=1,2,3)
sudo API=5 WORKER=5 VUS=100 HOLD=120s bash loadtest/run.sh   # heavier
sudo bash loadtest/down.sh                                   # tear down + wipe volumes
```

Then project to 100k DAU (pure Node, no docker, runs anywhere):

```bash
node loadtest/capacity-model.mjs            # see CAPACITY-MODEL.md
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

## Three scenarios — separating the bcrypt wall from I/O

A single mixed journey conflates two very different costs: cost-12 bcrypt (CPU-bound) and the
I/O tiers. `SCENARIO=` selects which one you measure:

| `SCENARIO` | script | measures |
|---|---|---|
| `auth` *(default)* | `scenario.js` | full journey **incl. signup** → the bcrypt/CPU ceiling (auth tier) |
| `io` | `scenario-io.js` | create + list + get with **reused JWTs** → write+queue+read I/O ceiling, **zero per-iter bcrypt** |
| `read` | `scenario-io.js` | list + get only → the dominant real-world read path |

`scenario-io.js` **amortizes auth**: it logs in a pool of users **once** in `setup()` (one
`bcrypt.compare` each, paid before the measured window) and every iteration reuses a JWT — so
the steady-state journey does no bcrypt and the step latencies are pure I/O. That per-node I/O
number is what the capacity model projects to 100k. `src/auth` is **untouched** — we move the
hash out of the hot loop, we never weaken `BCRYPT_SALT_ROUNDS=12`. The pool is created through
the real API (signup, falling back to login on a warm-stack re-run), so there's no DB seed
script or Dockerfile change. Knobs: `POOL` (pool size), `SEED_DELIVERIES` (per user, for the
read journey). `POOL` is bounded by `setupTimeout` (auto-scaled with `POOL`) on CPU-capped
nodes — a very large pool primes slowly (sequential cost-12 hashing).

> The load-test stack runs a **single Postgres** — no compose file sets `DATABASE_REPLICA_URL`
> — so `readWithFallback` serves the list/get reads from the **primary** via PgBouncer (the
> replica *routing* is covered by unit tests, not this harness). The measured `perNodeIoRps` is
> therefore a primary-served (pessimistic) read number; production offloads these to a replica.
> To exercise replica routing here, add a `postgres-replica` service + `DATABASE_REPLICA_URL`.

## Node isolation — defensible multi-node numbers (optional)

By default `--scale api=N` gives N replicas that all share the host's cores **unbounded** — so
"api=3" is three threads **contending** for 4 cores and per-replica throughput isn't
attributable. `NODES=1` layers `docker-compose.nodes.yml` to bound each container to a
**known-size compute unit** (an emulated "node") via `deploy.resources.limits` — which a
non-swarm `docker compose up` honors **per replica**. So N replicas = N×budget of real,
additive capacity, until a **shared** tier saturates.

```bash
sudo NODES=1 bash loadtest/run.sh            # 4-core budget (table below)
sudo NODES=1 API_CPUS=1.0 WORKER_CPUS=0.75 PG_CPUS=2.0 \
     API=4 WORKER=4 VUS=100 bash loadtest/run.sh   # 8-core host
```

| tier | per-replica CPU | per-replica mem | override |
|---|---|---|---|
| api | 0.6 | 640M | `API_CPUS` / `API_MEM` |
| worker | 0.4 | 512M | `WORKER_CPUS` / `WORKER_MEM` |
| postgres (shared) | 1.0 | 1G | `PG_CPUS` / `PG_MEM` |
| pgbouncer (shared) | 0.5 | 128M | `PGB_CPUS` / `PGB_MEM` |
| redis (shared) | 0.5 | 256M | `REDIS_CPUS` / `REDIS_MEM` |

> **Why a CPU quota, not `cpuset` pinning:** pinning ties every replica to the *same* cores, so
> adding a replica adds contention, not capacity. A fractional `cpus` quota lets the scheduler
> place each share anywhere — that's what makes added nodes *add* throughput. lb, migrate,
> mosquitto and **k6 are left unbounded** (a throttled load generator can't prove the ceiling).

The default CPU budget is intentionally **oversubscribed** on a 4-core box (api 3×0.6 + worker
3×0.4 + pg 1.0 + pgb 0.5 + redis 0.5 = 5.0 requested) — `cpus` is a ceiling, not a reservation,
so the host-core contention it surfaces *is* the ceiling the test finds. On a 4-core laptop the
sweep therefore demonstrates the **shape** (per-node ~flat until a shared tier *or host cores*
cap), not strict additive linearity; for a strict non-oversubscribed fit use `API_CPUS=0.4` or a
bigger box. Memory limits are a hard `memory.max` (unlike `cpus`, which only throttles): the
overlay adds a `NODE_OPTIONS=--max-old-space-size` cap per tier so V8 GCs before the kernel
OOM-kills a replica — **a replica restart during a run invalidates that step's per-node number**
(check `docker compose ps` for restarts if numbers look off).

**What it proves:** per-node throughput is attributable, and bounded nodes scale ~linearly
until a shared tier (PgBouncer pool / Postgres / host cores) caps — and the overlay makes that
ceiling a *known budget*, so you can say *which* tier capped. **What it can't:** true
cross-machine scale (one kernel partitioned by cgroups — no real NIC hop, NUMA, or per-host
page cache). Treat the **shape**, not the raw req/s, as the result; project with the model.

## Worker-tier drain + the horizontal-scaling sweep

`run.sh` automatically runs `metrics-probe.sh` around any write scenario: it snapshots
`drovery_queue_jobs` (queue-**global**, so it's correct through the round-robin LB), times the
SIM backlog draining back to ~0 after load stops, and prints a **jobs/sec/worker-node** number
plus partition-health (`default_rows ~0`). It measures drain from the backlog *gauge*, not the
BullMQ `completed` counter (which `removeOnComplete` caps at ~1000). `peak waiting ≈ 0` means
the worker kept up (the rate is a floor); a backed-up `waiting` means it saturated (the rate is
the real ceiling — feed it to the model).

`sweep.sh` runs the I/O scenario at `api=1,2,3` under a fixed per-node budget and tabulates
total vs **per-node** req/s. Per-node ~flat = clean linear scaling; a per-node drop = a shared
tier is capping (that's the ceiling).

## Capacity model → 100k DAU

[`CAPACITY-MODEL.md`](./CAPACITY-MODEL.md) + [`capacity-model.mjs`](./capacity-model.mjs) turn
the measured **per-node** numbers (above) into a node count for a target DAU, with a connection
budget, a Little's-Law check, and a sensitivity ranking — every assumption stated and
overridable from the CLI. Pure Node, no docker.

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

> The absolute numbers are still bounded by the single box, but `NODES=1` makes per-replica
> throughput **attributable** and `sweep.sh` shows it scales additively — so the harness now
> yields *defensible* per-node numbers, and `capacity-model.mjs` projects them to 100k DAU
> ([CAPACITY-MODEL.md](./CAPACITY-MODEL.md)). Re-measure the per-node constants on the target
> cloud node class before committing an absolute node count.

## Sample result (4-core laptop · api=3 worker=3 · 50 VUs · 90s)

```
checks ................ 100.00%  (4344/4344)   ✓ signup/create/list/get all 201/200
http_req_failed ....... 0.00%    (0/4344)      ← zero errors under load
http_reqs ............. 4344     33.2 req/s    (1086 full journeys)
http_req_duration p95 . 5.66s    ✗ (>1500ms)   ← entirely the signup step (below)

  step_create_delivery  p95 659ms   (DB write + payment + BullMQ enqueue)
  step_get_one          p95 323ms   (read)
  step_list             p95 248ms   (read)
  step_signup           p95 7.72s   ← bcrypt cost-12 hashing, CPU-bound
```

**Read:** correctness is perfect (0 failures, 100% checks) — the LB → API×3 → PgBouncer →
Postgres + worker-split + partitioned-writes design holds under load with no 5xx, no
timeouts, no pool exhaustion. The *only* latency pressure is `signup`: bcrypt at cost 12 is
deliberately CPU-hard, and 50 concurrent signups saturate a 4-core box that's ALSO running
the whole stack + k6 — so the CPU-bound hashing queues. The I/O-bound endpoints stayed fast
under the same load. This is the textbook signal horizontal scaling across real nodes fixes
(each API replica gets its own cores; bcrypt parallelizes) — NOT something to "fix" by
weakening the hash cost. The p95 threshold breach correctly *identified* the auth path as
the scaling pressure point.
