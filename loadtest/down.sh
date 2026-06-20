#!/usr/bin/env bash
# Tear down the load-test stack + wipe its volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
# Include the nodes overlay when it was used (NODES=1). `down` keys off the project name,
# so the base file set already removes nodes-overlay containers — this is just symmetry.
CF=(-f docker-compose.yml -f docker-compose.loadtest.yml)
[ "${NODES:-0}" = 1 ] && CF+=(-f docker-compose.nodes.yml)
docker compose "${CF[@]}" down -v
