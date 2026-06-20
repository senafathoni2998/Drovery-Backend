#!/usr/bin/env bash
# Worker-tier throughput probe (BullMQ queue drain) — pure curl + awk, no host installs.
#
# WHY: HTTP p95 only measures the API tier. Each delivery create fans 17 lifecycle jobs
# (5 STAGES + 12 position ticks, src/deliveries/simulation/simulation.constants.ts) to the
# WORKER tier via BullMQ. This probe produces a real "jobs/sec drained per worker node"
# number and confirms the partitioned write path stays healthy.
#
# It scrapes GET /api/v1/metrics through the LB. That route is @PublicApi() + @SkipThrottle()
# (src/metrics/metrics.controller.ts) so it needs NO JWT. drovery_queue_jobs is collected via
# getJobCounts(), which is queue-GLOBAL — every api replica reports the SAME backlog — so a
# single scrape through the round-robin LB is the correct system-wide number (do NOT sum
# across replicas). We deliberately measure drain from the backlog GAUGE, not the BullMQ
# `completed` counter: completed is capped at ~1000 by removeOnComplete (simulation.service.ts),
# so it would wildly undercount a real run.
#
# Usage (run.sh drives this):
#   metrics-probe.sh t0    <snapshot-file>     # baseline before k6
#   metrics-probe.sh drain <t0-snapshot-file>  # after k6: time the backlog → 0, print table
set -euo pipefail

PORT="${LB_PORT:-8088}"
URL="http://localhost:${PORT}/api/v1/metrics"
WORKER="${WORKER:-3}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-300}" # > the longest lifecycle delay (AWAITING_HANDOFF @120s) + slack
DRAIN_POLL="${DRAIN_POLL:-5}"

scrape() { curl -sf --max-time 5 "$URL"; }

# SIM backlog = waiting + active + delayed for the delivery-simulation queue (the KEDA scale
# signal). `delayed` dominates because lifecycle jobs are scheduled 10s–120s out. awk is kept
# mawk-safe: literal index() matches, value is the last field ($NF).
sim_backlog() {
  printf '%s\n' "$1" | awk '
    index($0,"drovery_queue_jobs{")==1 &&
    index($0,"queue=\"delivery-simulation\"") &&
    (index($0,"state=\"waiting\"") || index($0,"state=\"active\"") || index($0,"state=\"delayed\"")) { s+=$NF }
    END { printf "%d", s+0 }'
}
# `waiting` alone = jobs READY to run but not yet picked up → the true worker-SATURATION
# signal. If this stays ~0 under load, the worker keeps up (capacity ≥ demand).
sim_waiting() {
  printf '%s\n' "$1" | awk '
    index($0,"drovery_queue_jobs{")==1 &&
    index($0,"queue=\"delivery-simulation\"") && index($0,"state=\"waiting\"") { s+=$NF }
    END { printf "%d", s+0 }'
}
# Rows parked in any table DEFAULT partition — should be ~0; >0 means partition-maintenance lag.
default_rows() {
  printf '%s\n' "$1" | awk '
    index($0,"drovery_partition_default_rows{")==1 { s+=$NF }
    END { printf "%d", s+0 }'
}

case "${1:-}" in
  t0)
    OUT="${2:?usage: metrics-probe.sh t0 <file>}"
    if ! T=$(scrape); then
      echo "⚠ t0 probe: /api/v1/metrics unreachable at ${URL}" >&2
      exit 1
    fi
    {
      echo "default_rows_t0=$(default_rows "$T")"
      echo "ts0=$(date +%s)"
    } >"$OUT"
    ;;

  drain)
    IN="${2:?usage: metrics-probe.sh drain <t0file>}"
    default_rows_t0=0
    # Load the t0 vars safely (k=v lines) — NOT `source` (avoids executing file contents).
    if [ -f "$IN" ]; then
      while IFS='=' read -r k v; do
        case "$k" in default_rows_t0) default_rows_t0="$v" ;; esac
      done <"$IN"
    fi

    T=$(scrape) || {
      echo "⚠ drain probe: metrics unreachable — skipping worker table" >&2
      exit 0
    }
    peak_backlog=$(sim_backlog "$T")
    peak_waiting=$(sim_waiting "$T")

    # Nothing to drain (degenerate/tiny run, or the queue already cleared): report partition
    # health and bail — do NOT print a bogus "0.0 jobs/s" next to a healthy verdict. (-le 1
    # matches the loop's `-gt 1` terminator below.)
    if [ "$peak_backlog" -le 1 ]; then
      F=$(scrape) || F="$T"
      drows=$(default_rows "$F")
      printf '\n── WORKER-TIER THROUGHPUT (BullMQ SIM drain) ──────────────────────\n'
      printf 'SIM backlog already drained (or no queue sample) at probe time — no worker-\n'
      printf 'throughput sample this run. Raise VUS/HOLD or lower WORKER to force a backlog.\n'
      printf '%-30s %s\n' 'peak SIM backlog' "$peak_backlog"
      printf '%-30s %s → %s\n' 'partition DEFAULT rows (t0→now)' "$default_rows_t0" "$drows"
      [ "$drows" -gt 0 ] && printf '⚠ %s rows in a DEFAULT partition — partition maintenance is lagging.\n' "$drows"
      printf '───────────────────────────────────────────────────────────────────\n'
      exit 0
    fi

    # Poll the backlog down to ~0 (or the timeout). The drain rate (peak_backlog / elapsed) is
    # a conservative FLOOR, NOT a capacity figure when `waiting`≈0: most of the backlog is
    # DELAYED lifecycle jobs (scheduled out to ~120s), so `elapsed` is pinned near the longest
    # remaining delay REGARDLESS of worker speed — and won't shrink as you add worker nodes.
    # The rate becomes a real per-node ceiling ONLY when `waiting` backs up (worker-bound).
    #
    # The in-loop scrape is guarded: a transient miss returns empty → sim_backlog would read 0
    # and falsely "drain" the queue, overstating the rate. Keep the last good `cur` on a miss;
    # abort the timing as UNRELIABLE only after several consecutive misses.
    start=$(date +%s)
    cur=$peak_backlog
    misses=0
    reliable=1
    while [ "$cur" -gt 1 ]; do
      now=$(date +%s)
      [ $((now - start)) -ge "$DRAIN_TIMEOUT" ] && break
      sleep "$DRAIN_POLL"
      if S=$(scrape); then
        cur=$(sim_backlog "$S")
        misses=0
      else
        misses=$((misses + 1))
        echo "⚠ transient scrape miss (${misses}), keeping backlog=${cur}" >&2
        if [ "$misses" -ge 3 ]; then
          echo "⚠ drain probe: ${misses} consecutive scrape failures — drain timing UNRELIABLE" >&2
          reliable=0
          break
        fi
      fi
    done
    end=$(date +%s)
    elapsed=$((end - start))
    [ "$elapsed" -lt 1 ] && elapsed=1

    F=$(scrape) || F="$T"
    rate=$(awk -v b="$peak_backlog" -v e="$elapsed" 'BEGIN { printf "%.1f", b / e }')
    per=$(awk -v b="$peak_backlog" -v e="$elapsed" -v w="$WORKER" 'BEGIN { printf "%.1f", b / (e * w) }')
    drows=$(default_rows "$F")

    printf '\n── WORKER-TIER THROUGHPUT (BullMQ SIM drain) ──────────────────────\n'
    printf '%-30s %s\n' 'peak SIM backlog (w+a+delayed)' "$peak_backlog"
    printf '%-30s %s\n' 'peak waiting (saturation sig)' "$peak_waiting"
    printf '%-30s %s s\n' 'drain elapsed' "$elapsed"
    printf '%-30s %s\n' 'final SIM backlog' "$cur"
    printf '%-30s %s jobs/s\n' 'drain rate (total)' "$rate"
    printf '%-30s %s jobs/s/node  (WORKER=%s, conc=10)\n' 'drain rate (per worker node)' "$per" "$WORKER"
    printf '%-30s %s → %s\n' 'partition DEFAULT rows (t0→now)' "$default_rows_t0" "$drows"
    printf '───────────────────────────────────────────────────────────────────\n'
    [ "$reliable" = 0 ] &&
      printf '⚠ drain timing degraded by repeated scrape misses — treat the rate as INDICATIVE only.\n'
    if [ "$peak_waiting" -lt 5 ]; then
      printf 'read: waiting~0 → the worker tier kept UP with enqueue (capacity >= demand). The rate\n'
      printf '      above is NOT a capacity figure: with waiting~0 the elapsed time is bounded by the\n'
      printf '      lifecycle DELAY schedule (~120s past the last create), not worker speed, so it\n'
      printf '      will not move as you add workers. Raise VUS or lower WORKER until waiting backs\n'
      printf '      up to measure the real per-node ceiling.\n'
    else
      printf 'read: waiting backed up (%s) → the worker tier SATURATED; the per-node rate is the\n' "$peak_waiting"
      printf '      real ceiling. This is the number to feed the capacity model (--perWorkerJobsPerSec).\n'
    fi
    if [ "$drows" -gt 0 ]; then
      printf '⚠ %s rows in a DEFAULT partition — partition maintenance is lagging.\n' "$drows"
    fi
    ;;

  *)
    echo "usage: $0 {t0 <file> | drain <t0file>}" >&2
    exit 2
    ;;
esac
