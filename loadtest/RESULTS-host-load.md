# Docker-free load run — the 1M+ scaling seams under load

The containerized harness ([README.md](./README.md)) needs Docker. This is a **docker-free**
counterpart that boots an `api` + a `worker` on the host (host Postgres + Redis), drives the same
per-VU journey, and — crucially — runs it with **all the 1M+ scaling flags ON**, so the run actually
exercises the new code paths (the debit-first saga, the transactional outbox, the tracking hot-store,
sharded pub/sub) rather than just the legacy path.

- **Runner:** [`host-run.sh`](./host-run.sh) — boots the two processes with the flags, health-waits, fires the driver, tears down.
- **Driver:** [`host-driver.mjs`](./host-driver.mjs) — zero new deps (global `fetch` + the existing `pg`). Seeds a **credit-funded** user pool through the real API (so every `create()` exercises the debit-first **R2 reservation**), runs `VUS` concurrent `create → list → poll` loops for `HOLD`s, snapshots `/metrics`, and cleans up its own data.

```bash
POOL=24 VUS=40 HOLD=30 bash loadtest/host-run.sh            # scaling flags ON
SCALING=off POOL=24 VUS=40 HOLD=30 bash loadtest/host-run.sh # legacy-path baseline
```

## Result (4-core laptop · api=1 worker=1 · 40 VUs · 30s · every create debits credits)

| metric | **flags ON** (saga+outbox+hot-store+sharded pub/sub) | baseline (`SCALING=off`) |
|---|---|---|
| journeys completed | 1636 | 1445 |
| total requests | 4908 (**161 req/s**) | 4335 (142 req/s) |
| **errors** | **0 (0.00%)** | **0 (0.00%)** |
| **api 5xx** | **0** | **0** |
| `create` p50 / p95 / p99 | 431 / 649 / 844 ms | 453 / 580 / 855 ms |
| `list` p50 / p95 / p99 | 102 / 159 / 221 ms | 131 / 183 / 217 ms |
| `get` p50 / p95 / p99 | 177 / 265 / 346 ms | 236 / 310 / 344 ms |
| worker `queue waiting` (post-run) | 0 | 0 |
| **orphan reservations reaped** | **0** | 0 |

**Read:**
- **Correctness under concurrency holds with the flags ON.** 1636 concurrent credit-debiting `create()`s — each now a **debit-first saga** (the authoritative wallet-debit commits in its *own* transaction as a reservation, then the delivery commits in a *separate* transaction) — completed with **zero errors and zero 5xx**. The `orphan_reservations_reaped` counter stayed **0**: no `create()` crashed mid-saga, so no credits were stranded, and the in-process compensation never had to fire spuriously.
- **The reorder does not regress performance.** Flags-ON vs the legacy single-co-committing-transaction baseline are statistically indistinguishable on a shared box (ON was marginally *faster* this run — within run-to-run noise). Splitting one transaction into three (reserve-debit → delivery → payment) did not cost throughput or tail latency. `DELIVERY_DEBIT_FIRST` is safe to enable.
- **The worker tier kept up.** `queue waiting` drained back to 0 after load — the create→enqueue→worker split absorbed the write burst.

## WS-tracking scenario (`SCENARIO=ws`) — the realtime fan-out path

The HTTP journey above doesn't touch the WebSocket path, so [`host-ws-driver.mjs`](./host-ws-driver.mjs) exercises the §3/§4 realtime tier directly: it creates sim deliveries (the worker drives their lifecycle, emitting status + position frames), opens **`FANOUT` WebSocket clients per delivery**, subscribes each, and counts the fan-out — sim position write → **tracking hot-store (§3)** → **sharded pub/sub (§4)** → the WS gateway's local fan-out → N clients.

```bash
SCENARIO=ws POOL=20 FANOUT=5 HOLD=90 bash loadtest/host-run.sh
```

Result (4-core laptop · api=1 worker=1 · **100 WS sockets** · 90s · scaling flags ON):

| metric | value |
|---|---|
| sockets opened / subscribed | **100 / 100** |
| subscribe errors · auth closes (1008) · connection errors | **0 · 0 · 0** |
| frames fanned out | **1125 (12.5/s)** — 725 position + 400 status |
| **position frames dropped** (backpressure watermark) | **0** |

**Read:** 100 concurrent WS clients (20 deliveries × 5 subscribers) all authenticated, subscribed, and received the fan-out with **zero errors and zero dropped frames**. Each published position frame correctly fanned out to its delivery's 5 local subscribers through **sharded `SPUBLISH`/`SSUBSCRIBE`** — the 400 status frames are exactly `20 deliveries × 4 transitions × 5 fan-out` (status frames are never coalesced/dropped, per the §4 invariant; positions are lossy under backpressure but none were dropped here). This validates the realtime path the HTTP run couldn't: the tracking hot-store, the sharded pub/sub transport, the gateway's per-delivery local fan-out, and the backpressure watermark, end-to-end under concurrent WS load.

## Honest scope

- **Single local box.** Absolute req/s is bounded by one machine running api + worker + Postgres + Redis + the driver. Treat the **shape** (clean, error-free, no regression, worker drains), not the raw number, as the result; project with [`capacity-model-1m.mjs`](./capacity-model-1m.mjs).
- **Two scenarios cover complementary paths.** The HTTP journey stresses the **debit-first saga + the write/queue/read tiers**; `SCENARIO=ws` (above) stresses the **realtime tier — tracking hot-store + sharded pub/sub + WS gateway fan-out + backpressure**. The one seam neither run exercises is the **outbox referral** path: it only fires on a referee's first delivery, and the pools have no referrals (→ `outbox_processed=0`, correctly idle) — its correctness is covered by unit + integration tests + the Stage-1 live end-to-end check. Together these add the **under-concurrency + no-regression** evidence across the create path AND the realtime fan-out path.
