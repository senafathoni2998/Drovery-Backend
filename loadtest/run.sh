#!/usr/bin/env bash
# One command to run the load test: bring the scaled stack up, WAIT for the LB to be
# healthy, then fire k6 (with the scales passed to `run` too, so it can't silently
# rescale api/worker back to 1). Usage from the repo root:
#
#   sudo bash loadtest/run.sh                                   # api=3 worker=3 VUS=50 HOLD=90s
#   sudo API=5 WORKER=5 VUS=100 HOLD=120s bash loadtest/run.sh  # heavier
#
# Tear down after with:  sudo bash loadtest/down.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CF=(-f docker-compose.yml -f docker-compose.loadtest.yml)
API="${API:-3}"
WORKER="${WORKER:-3}"
PORT="${LB_PORT:-8088}"

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
echo "✅ stack healthy — firing k6 (VUS=${VUS:-50} HOLD=${HOLD:-90s})"

docker compose "${CF[@]}" run --rm --scale "api=$API" --scale "worker=$WORKER" \
  -e VUS="${VUS:-50}" -e RAMP="${RAMP:-30s}" -e HOLD="${HOLD:-90s}" k6
