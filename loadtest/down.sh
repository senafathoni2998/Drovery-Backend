#!/usr/bin/env bash
# Tear down the load-test stack + wipe its volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml down -v
