#!/usr/bin/env bash
# One command to run the load test: bring the scaled stack up, WAIT for the LB to be
# healthy, then fire k6 (with the scales passed to `run` too, so it can't silently
# rescale api/worker back to 1). Usage from the repo root:
#
#   sudo bash loadtest/run.sh                                    # auth journey, api=3 worker=3
#   sudo NODES=1 bash loadtest/run.sh                            # + bound each replica (real "nodes")
#   sudo NODES=1 SCENARIO=io   VUS=100 bash loadtest/run.sh      # pure-I/O ceiling (auth amortized)
#   sudo NODES=1 SCENARIO=read VUS=200 bash loadtest/run.sh      # read-only ceiling
#   sudo API=5 WORKER=5 VUS=100 HOLD=120s bash loadtest/run.sh   # heavier
#
# Knobs: NODES (1 = bound each replica via docker-compose.nodes.yml), SCENARIO
# (auth|io|read), API/WORKER (scales), VUS/RAMP/HOLD, POOL/SEED_DELIVERIES (io/read pool),
# LB_PORT. Tear down after with:  sudo bash loadtest/down.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CF=(-f docker-compose.yml -f docker-compose.loadtest.yml)
API="${API:-3}"
WORKER="${WORKER:-3}"
PORT="${LB_PORT:-8088}"
SCENARIO="${SCENARIO:-auth}" # auth (scenario.js, signup/bcrypt wall) | io | read (scenario-io.js)
POOL="${POOL:-50}"
SEED_DELIVERIES="${SEED_DELIVERIES:-1}"
PROBE="$(dirname "$0")/metrics-probe.sh"

# OPTIONAL third overlay: bound each replica to a known CPU/mem unit so per-node throughput
# is attributable (see docker-compose.nodes.yml). Default run is byte-identical without it.
if [ "${NODES:-0}" = 1 ]; then
  CF+=(-f docker-compose.nodes.yml)
  echo "▸ node-isolation ON — per-replica caps: api=${API_CPUS:-0.6}cpu/${API_MEM:-1G}, worker=${WORKER_CPUS:-0.4}cpu/${WORKER_MEM:-768M}"
else
  echo "▸ node-isolation OFF (set NODES=1 to bound each replica to a known CPU/mem unit)"
fi

case "$SCENARIO" in
  io | read) SCRIPT="scenario-io.js" ;;
  *) SCRIPT="scenario.js" ;;
esac
echo "▸ scenario=$SCENARIO → $SCRIPT"

echo "▶ building + starting (api=$API worker=$WORKER) ..."
docker compose "${CF[@]}" up -d --build --scale "api=$API" --scale "worker=$WORKER"

echo "⏳ waiting for the LB at http://localhost:$PORT/api/v1/health ..."
ok=0
for i in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$PORT/api/v1/health"; then ok=1; break; fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  echo "❌ LB never went healthy — nginx log:"
  docker compose "${CF[@]}" logs lb --tail=25
  exit 1
fi
echo "✅ stack healthy — firing k6 (SCENARIO=$SCENARIO VUS=${VUS:-50} HOLD=${HOLD:-90s})"

# Worker-drain baseline BEFORE k6 — only for scenarios that write (auth + io enqueue jobs).
# Guarded so a metrics hiccup never aborts the run (set -e).
T0=""
if [ "$SCENARIO" != "read" ]; then
  T0="$(mktemp)"
  LB_PORT="$PORT" WORKER="$WORKER" bash "$PROBE" t0 "$T0" || echo "⚠ t0 probe skipped"
fi

# --no-deps: the stack is already up at the requested scale (above), so DON'T let `run`
# reconcile dependencies — that's what silently rescales api/worker back to 1. (This
# compose build's `run` also rejects `--scale`, so --no-deps is the portable fix.)
# Passing `run /scripts/$SCRIPT` as the service args REPLACES the k6 service's default command.
#
# k6 exits 99 when ANY threshold is crossed (e.g. p95 over budget on a contended box) — that
# is EXPECTED here and must NOT abort the script under `set -e`, or the post-load worker-drain
# measurement below (a core deliverable + the model's perWorkerJobsPerSec input) would be lost.
# So we capture the code and continue, mirroring the `|| ...` guards on the probe calls.
set +e
docker compose "${CF[@]}" run --rm --no-deps \
  -e VUS="${VUS:-50}" -e RAMP="${RAMP:-30s}" -e HOLD="${HOLD:-90s}" \
  -e SCENARIO="$SCENARIO" -e POOL="$POOL" -e SEED_DELIVERIES="$SEED_DELIVERIES" \
  k6 run "/scripts/$SCRIPT"
K6_RC=$?
set -e
if [ "$K6_RC" -ne 0 ]; then
  echo "⚠ k6 exited $K6_RC (99 = a threshold was crossed — expected on a shared box; continuing to the drain measurement)"
fi

# Worker-tier drain measurement AFTER load (lifecycle jobs keep draining ~2min past k6).
if [ -n "$T0" ]; then
  echo "⏳ measuring worker-tier drain (sampling SIM backlog → 0; up to a few min) ..."
  LB_PORT="$PORT" WORKER="$WORKER" bash "$PROBE" drain "$T0" || echo "⚠ drain probe skipped"
  rm -f "$T0"
fi

# Surface the k6 verdict LAST (after the worker table) without aborting — so a threshold
# breach is reported, not hidden, but the per-tier numbers above are still produced.
if [ "${K6_RC:-0}" -ne 0 ]; then
  echo "▸ note: k6 reported a threshold breach (rc=$K6_RC) — HTTP SLOs not all met, but the per-tier numbers above are valid."
fi
