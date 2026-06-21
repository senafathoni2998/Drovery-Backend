# Capacity model — projecting to 100k DAU

A single load-test number on one laptop does **not** answer "can this serve 100k users?".
This document explains how the harness produces *defensible* multi-node numbers and how
[`capacity-model.mjs`](./capacity-model.mjs) turns measured **per-node** throughput into a
node count for a target DAU — with every assumption stated and overridable.

```bash
node loadtest/capacity-model.mjs                 # 100k headline (runs on prior-run defaults)
node loadtest/capacity-model.mjs --dau=2000000   # any what-if, no edit needed
```

## Why one load-test number lies

The prior run (api=3 worker=3, 50 VUs, 90s on a 4-core laptop) returned **33.2 req/s** with
global **p95 5.66s** — which looks like a failure against a 1500ms SLO. But that p95 was
**entirely** the cost-12 bcrypt **signup** step (p95 7.72s, CPU-bound) saturating a box that
also ran the whole stack + k6. The I/O steps stayed fast the entire time:

| step | p95 | nature |
|---|---|---|
| signup | **7.72s** | bcrypt cost-12, CPU-bound |
| create delivery | 659ms | DB write + mock payment + BullMQ enqueue |
| list deliveries | 248ms | read |
| get one | 323ms | read |

One number conflated a **CPU wall** (signup) with **I/O throughput** (everything else), on a
box where every tier fought for 4 cores. The fix is to measure each tier **in isolation** and
project **per-node** capacity — which is exactly what the enhanced harness does.

## The three measured inputs (and how to get them — `FILL FROM RUN`)

The model's supply side is three numbers measured on a node of a *known size*
(`docker-compose.nodes.yml` bounds each replica to a fixed CPU/mem unit — see
[README](./README.md#node-isolation)):

| constant | how it's measured | scenario |
|---|---|---|
| `perNodeIoRps` | push VUs until the I/O p95 hits the SLO; sustained req/s ÷ api replicas | `SCENARIO=io` (auth amortized in `setup()`, per-iter journey is pure I/O) |
| `perWorkerJobsPerSec` | enqueue a known backlog; time `drovery_queue_jobs` → 0; jobs ÷ elapsed ÷ workers | the drain probe (`metrics-probe.sh`, run automatically) |

> The probe's automatic number is a **floor**, not a capacity figure, when the worker keeps up
> (`peak waiting ≈ 0`): most of the backlog is *delayed* lifecycle jobs scheduled out to ~120s,
> so the drain time is bounded by that delay schedule, not worker speed. The real per-node
> ceiling comes from a **saturated** run — raise VUS / lower WORKER until `waiting` backs up, and
> feed that into `--perWorkerJobsPerSec`.
| `bcryptCost12MsPerHash` | time one cost-12 hash on the **target** node class | the `auth` scenario cross-checks it |

The key move is **auth amortization**: `scenario-io.js` logs in a pool of users **once** in
`setup()`, then every iteration reuses a JWT — so the per-iteration journey does **zero**
bcrypt and the step latencies reflect DB/PgBouncer/queue I/O, not CPU hashing. We never lower
`BCRYPT_SALT_ROUNDS=12` — that would be a security regression; we move the cost out of the
measured loop instead.

> The shipped defaults are **conservative placeholders** derived from the prior shared-box
> run. They let the model run today; they are **not** dedicated-node measurements. Replace
> them (`--perNodeIoRps=…` or edit Section 1) once you have isolated runs on the target node.

## Demand assumptions (each stated, each overridable)

| input | default | basis |
|---|---|---|
| `dau` | 100,000 | the headline target |
| `reqsPerUserPerDay` | 30 | a logistics app is read/poll-heavy; most days are lists + tracking polls |
| read / write / auth mix | 0.78 / 0.20 / 0.02 | reads dominate; "auth" = login/refresh (signup is sized separately) |
| `newUsersPerDay` | 3,000 | ~3% of DAU/day — the **only** thing hitting the cost-12 wall |
| `deliveryCreatesPerUserPerDay` | 1.5 | the only write that fans lifecycle jobs to the worker tier |
| `peakHourShare` | 0.10 | fraction of daily volume in the busiest hour → **peakFactor = 0.10 × 24 = 2.4×** the average hour |

`jobsPerCreate = 17` is **not** an assumption — it's read straight from the code (`addBulk([…5
STAGES, …12 position ticks])` in `src/deliveries/simulation/`). A scheduled delivery adds one
kickoff job that later fans the same 17.

## The formulas

```
peakFactor   = peakHourShare × 24                       (peak-hour rps ÷ average-hour rps)
avgRps       = dau × reqsPerUserPerDay / 86400
peakRps      = avgRps × peakFactor

# API I/O tier (reads + writes + login — signup excluded)
peakIoRps        = peakRps × (read + write + auth)
requiredApiNodes = ceil(peakIoRps / perNodeIoRps)

# Worker tier — sized from delivery CREATES × the real 17-job fan-out (not a flat write %)
peakCreateRps      = dau × deliveryCreatesPerUserPerDay / 86400 × peakFactor
peakJobsPerSec     = peakCreateRps × 17
requiredWorkerNodes= ceil(peakJobsPerSec / perWorkerJobsPerSec)

# Signup tier — sized from NEW users/day against the CPU-bound hash ceiling
peakSignupPerSec    = newUsersPerDay / 86400 × peakFactor
signupCeilingPerNode= (1000 / bcryptCost12MsPerHash) × coresPerNode
requiredSignupNodes = ceil(peakSignupPerSec / signupCeilingPerNode)

apiFleet = max(requiredApiNodes, requiredSignupNodes)     # one tier absorbs both

# Connection budget (the real eventual ceiling)
clientConns = apiFleet × apiPoolMax(10) + workerNodes × workerPoolMax(5)   vs  MAX_CLIENT_CONN 1000
# PgBouncer transaction-pools all of those onto DEFAULT_POOL_SIZE(20) Postgres conns.

# Little's Law sanity: in-flight = peakIoRps × mean I/O latency
```

Signup is sized from **new users/day**, never as a fraction of steady traffic — a user signs
up once, then makes thousands of I/O requests. That keeps the bcrypt wall orthogonal: at 100k
DAU signup demand is ~0.08/s (trivially one node), which proves the "wall" was a co-tenancy
**latency** artifact on a shared box, not a **throughput** ceiling.

## The projection at 100k DAU

```
┌────────────────────────────────────┬──────────────────────┬────────────────┬──────────────────────────────┐
│ Component                          │    Per-node capacity │    Nodes @100k │ Limiting factor              │
├────────────────────────────────────┼──────────────────────┼────────────────┼──────────────────────────────┤
│ API I/O (read+write+login)         │            220 req/s │              1 │ CPU + PgBouncer pool         │
│ Signup (bcrypt cost-12)            │           7.6 sign/s │              1 │ CPU hash (264ms/hash)        │
│ API fleet (max of above)           │                    — │              1 │ I/O-bound                    │
│ Worker (BullMQ drain)              │           120 jobs/s │              1 │ jobs/create=17 · DB writes   │
└────────────────────────────────────┴──────────────────────┴────────────────┴──────────────────────────────┘
Connection budget: 1×10 (api) + 1×5 (worker) = 15 of 1000  →  98.5% headroom ✅
Little's Law:      83.3 req/s × 0.410s = 34.2 in-flight ✅
VERDICT: 1 api + 1 worker nodes serve 100,000 DAU at the SLO. Tightest tier: Worker (41% headroom).
```

Read honestly: at 100k DAU on the conservative placeholders, the bottleneck is **not** node
count — it's **one of each tier with headroom to spare**. The deliverable is the *architecture*
(LB → api → PgBouncer → Postgres + worker-split + partitioned writes), which is efficient
enough that 100k DAU is comfortable. The model's value is showing **where** the ceiling is and
that it scales **linearly**:

```
node loadtest/capacity-model.mjs --dau=2000000 --deliveryCreatesPerUserPerDay=2
  → 8 api + 16 worker nodes; 160/1000 client conns (84% headroom)
```

Node counts rise ~linearly with demand; the **PgBouncer client-connection budget** (1000) is
the eventual ceiling — and it isn't hit until ~95 api nodes, far beyond 100k DAU.

## Why the connection budget is the scaling story

Every api/worker replica opens up to its `DATABASE_POOL_MAX` connections to **PgBouncer**, not
directly to Postgres. PgBouncer (transaction pooling) multiplexes all of them onto a small
fixed server-side pool (`DEFAULT_POOL_SIZE = 20`). So the app tiers can autoscale to ~1000
client connections while Postgres only ever sees ~20 — `max_connections` is **never** the
limit. That decoupling is what makes horizontal scaling actually work.

## Sensitivity & what to measure first

The model ranks each demand dial by how much it moves the node count (±25%, one-at-a-time). At
100k everything rounds to one node, so re-run at higher load to see the ranking:

```
node loadtest/capacity-model.mjs --dau=2000000
```

`dau`, `reqsPerUserPerDay`, and `peakHourShare` tie as most load-bearing — they're **business**
assumptions to validate with product analytics. The **supply** constants (`perNodeIoRps`,
`perWorkerJobsPerSec`) should be re-measured on the **target cloud node class** before trusting
absolute counts: 0.6 CPU of a laptop core ≠ 0.6 of a cloud vCPU.

## What this proves — and what it can't

- **Proves:** per-node throughput is *attributable* (bounded replicas), the tiers scale
  independently and ~linearly, and the connection budget — not Postgres — is the ceiling.
- **Can't prove:** true cross-machine numbers. The local harness is one kernel partitioned by
  cgroups — no real NIC hop between tiers, no NUMA, no per-host page cache contention. Treat
  the **shape** (linear-until-a-shared-tier-saturates, *which* tier) as the result; re-measure
  the absolute per-node constants on real infra before committing a cloud node count.
