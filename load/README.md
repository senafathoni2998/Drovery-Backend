# Load tests (k6)

Drives the real **create → track → deliver** path to (a) measure throughput/latency
and (b) prove the service scales horizontally. k6 is not assumed installed locally —
use the `grafana/k6` Docker image.

## Run

```bash
# Smoke (1 VU, 30s sanity):
docker run --rm -i --network host \
  -e BASE_URL=http://localhost:3000/api/v1 -e SCENARIO=smoke \
  grafana/k6 run - < load/create-track-deliver.js

# Main ramping load (up to 100 VUs):
docker run --rm -i --network host \
  -e BASE_URL=http://localhost:3000/api/v1 -e SCENARIO=ramp \
  grafana/k6 run - < load/create-track-deliver.js

# Prove the shared rate limiter holds (bypass OFF):
docker run --rm -i --network host \
  -e BASE_URL=http://localhost:3000/api/v1 -e SCENARIO=throttle_proof \
  grafana/k6 run - < load/create-track-deliver.js
```

> On macOS `--network host` differs — publish a port and use
> `-e BASE_URL=http://host.docker.internal:3000/api/v1`, or point at a published LB.

## The two rate-limit traps (read before measuring throughput)

1. **`/auth` is throttled 10/min/IP.** The script logs in **once per VU** and
   reuses the bearer (`load/lib/common.js`). Don't move login into the loop.
2. **The global 100/min/IP limit is Redis-backed and SHARED across replicas.** A
   single k6 IP trips it in seconds, and because the counter is shared, adding
   replicas does **not** raise the ceiling — 2 replicas would look identical to 1,
   falsifying the scaling claim. For **throughput** runs, deploy the API with
   `LOADTEST_BYPASS_THROTTLE=true` (non-prod only — the app refuses to boot with
   it under `NODE_ENV=production`).

## Proving ~2× throughput (horizontal scaling)

The `$0` path uses docker-compose (compose maps a single host port, so put a
load balancer in front, or compare at the queue/worker level):

```bash
# baseline: 1 api + workers
LOADTEST_BYPASS_THROTTLE=true docker compose up --build
#   run SCENARIO=ramp, record iterations/s + http_reqs/s at the 100-VU stage

# scale out: 2 api + 3 workers (front them with an nginx/traefik LB, point BASE_URL at it)
docker compose up --build --scale api=2 --scale worker=3
#   re-run the same ramp; ~2x iterations/s with create_delivery_duration p95 flat
#   = clean horizontal scaling (the bottleneck isn't a single instance).
```

Keep `--scale worker=3` up or the BullMQ backlog grows and deliveries never reach
`DELIVERED` (the script only polls a few times, so latency still reads fine, but
the queue would balloon — visible as `drovery_queue_jobs{state="delayed"}` rising).

## Reading results

- `iterations` rate and `http_reqs` rate — compare across replica counts.
- `create_delivery_duration` p95 — should stay ~flat as load rises (DB write + enqueue).
- `track_poll_duration` p95 — the read path.
- `business_errors` — non-2xx app responses (should be < 1%).
