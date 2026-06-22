#!/usr/bin/env bash
# Docker-free load run — the counterpart to run.sh for hosts without Docker. Boots an api + a
# worker on the host (using the host's Postgres + Redis) with the 1M+ scaling flags ON, fires
# loadtest/host-driver.mjs (zero new deps), then tears the processes down. The driver seeds +
# cleans up its own user pool.
#
#   POOL=40 VUS=50 HOLD=45 bash loadtest/host-run.sh
set -uo pipefail
cd "$(dirname "$0")/.."

# Load .env (DATABASE_URL, JWT secrets, etc.) without exporting comments/blanks.
set -a; source <(grep -vE '^\s*(#|$)' .env); set +a

# The 1M+ scaling seams, all ON for this run (default-OFF in prod). LOADTEST_BYPASS_THROTTLE so a
# single-source-IP load isn't capped by the per-IP limiter (the guard hard-disables it under
# NODE_ENV=production; NODE_ENV is unset here). Set SCALING=off for the legacy-path baseline.
FLAGS=( LOADTEST_BYPASS_THROTTLE=true METRICS_ENABLED=true )
if [ "${SCALING:-on}" != "off" ]; then
  FLAGS+=(
    TRACKING_HOT_STORE=redis
    REDIS_PUBSUB_MODE=sharded
    DELIVERY_OUTBOX_REFERRAL=true
    DELIVERY_DEBIT_FIRST=true
  )
  echo "scaling flags: ON (hot-store, sharded pub/sub, outbox referral, debit-first saga)"
else
  echo "scaling flags: OFF (legacy co-committing path — baseline)"
fi

command -v redis-server >/dev/null && (redis-cli -p 6379 ping >/dev/null 2>&1 || redis-server --port 6379 --daemonize yes --save "" --appendonly no >/dev/null 2>&1)
sleep 1

echo "booting api (:3000) + worker (metrics :9091) with scaling flags ON ..."
env "${FLAGS[@]}" PROCESS_ROLE=api PORT=3000 node dist/src/main.js > /tmp/hostlt-api.log 2>&1 &
API_PID=$!
env "${FLAGS[@]}" PROCESS_ROLE=worker METRICS_PORT=9091 node dist/src/worker.js > /tmp/hostlt-worker.log 2>&1 &
WORKER_PID=$!

cleanup() { kill "$API_PID" "$WORKER_PID" 2>/dev/null; }
trap cleanup EXIT

# Wait for the api to be healthy.
for i in $(seq 1 40); do
  curl -sf "http://localhost:3000/api/v1/health" >/dev/null 2>&1 && { echo "api healthy after ${i}s"; break; }
  if [ "$i" = 40 ]; then echo "api never came up — tail of api log:"; tail -15 /tmp/hostlt-api.log; exit 1; fi
  sleep 1
done

env "${FLAGS[@]}" node loadtest/host-driver.mjs
RC=$?
echo "(api/worker logs: /tmp/hostlt-api.log /tmp/hostlt-worker.log)"
exit $RC
