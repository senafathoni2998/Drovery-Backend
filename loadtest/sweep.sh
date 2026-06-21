#!/usr/bin/env bash
# Horizontal-scaling sweep — the "does adding a node add throughput?" proof.
#
# Runs the PURE-I/O scenario (auth amortized, so we measure I/O scaling, not the bcrypt
# wall) at a FIXED per-replica CPU budget (NODES=1) across api=1,2,3, and tabulates the
# sustained req/s plus the PER-NODE efficiency. Clean horizontal scaling shows total req/s
# rising while per-node req/s stays ~flat — until a SHARED tier (PgBouncer pool / Postgres /
# host cores) saturates and per-node efficiency starts dropping. That inflection is the
# input the capacity model needs (per_node_io_rps) and the ceiling it projects from.
#
#   sudo bash loadtest/sweep.sh                       # api in 1 2 3, worker=2, VUS=100
#   sudo APIS="1 2 4" WORKER=3 VUS=150 bash loadtest/sweep.sh
#
# Each step brings the stack up at that api scale (NODES=1 bounds every replica), fires k6,
# and tees the summary to loadtest/sweep-apiN.log. Tear down after with loadtest/down.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

APIS="${APIS:-1 2 3}"
WORKER="${WORKER:-2}"
VUS="${VUS:-100}"
HOLD="${HOLD:-90s}"
RESULTS=()

for n in $APIS; do
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "▶ SWEEP step: api=$n worker=$WORKER (NODES=1, SCENARIO=io, VUS=$VUS)"
  echo "════════════════════════════════════════════════════════════════"
  log="loadtest/sweep-api${n}.log"
  # Reuse run.sh for the up/health/k6 plumbing; force node-isolation + the I/O scenario.
  NODES=1 SCENARIO=io API="$n" WORKER="$WORKER" VUS="$VUS" HOLD="$HOLD" \
    bash loadtest/run.sh 2>&1 | tee "$log" || true

  # k6 prints e.g. "http_reqs....................: 8123   90.2/s". Pull the per-second rate.
  rate=$(awk '/http_reqs/ { for (i = 1; i <= NF; i++) if ($i ~ /\/s$/) { gsub(/\/s$/, "", $i); print $i; exit } }' "$log")
  rate="${rate:-0}"
  RESULTS+=("$n|$rate")
done

echo ""
echo "── HORIZONTAL SCALING (SCENARIO=io, NODES=1, per-replica CPU=${API_CPUS:-0.6}) ──"
printf '%-8s %-16s %-16s %s\n' 'api' 'total req/s' 'per-node req/s' 'scaling'
prev_per=""
for r in "${RESULTS[@]}"; do
  n="${r%%|*}"
  rate="${r##*|}"
  per=$(awk -v t="$rate" -v c="$n" 'BEGIN { printf "%.1f", (c > 0 ? t / c : 0) }')
  note=""
  if [ -n "$prev_per" ]; then
    note=$(awk -v p="$per" -v q="$prev_per" 'BEGIN { printf "%+.0f%% per-node", (q > 0 ? (p / q - 1) * 100 : 0) }')
  fi
  printf '%-8s %-16s %-16s %s\n' "$n" "$rate" "$per" "$note"
  prev_per="$per"
done
echo "─────────────────────────────────────────────────────────────────────"
echo "Read: per-node req/s ~flat across api counts = clean linear scaling (each added node"
echo "      adds real capacity). A per-node DROP = a shared tier (pool/PG/cores) is capping —"
echo "      that's the ceiling; feed the highest sustained per-node req/s to capacity-model.mjs"
echo "      (--perNodeIoRps=…). Tear down: sudo bash loadtest/down.sh"
