# Partitioning runbook

PostgreSQL native **time-range partitioning** for high-volume, append-heavy tables.
Today: **`notifications`** (the reference implementation). This doc is the operational
contract — read it before touching a partitioned table or the migration workflow.

## What's partitioned

| Table | Strategy | Key | Children |
|-------|----------|-----|----------|
| `notifications` | `RANGE("createdAt")` | composite PK `(id, "createdAt")` | monthly `notifications_yYYYYmMM` + a permanent `notifications_default` |

Migration: `prisma/migrations/20260616120000_partition_notifications/migration.sql`.

## Prisma rules (do not violate)

- **The model PK is composite `@@id([id, "createdAt"])`** (id-first, so a bare-id lookup
  still uses each child's PK index). A range-partitioned table *requires* the partition
  key in every unique/PK constraint.
- **There is no single-column `id` unique anymore.** `findUnique/update/delete({ where: { id } })`
  on a partitioned model won't compile. Scope writes by `(id, userId)` via `updateMany`
  / `findFirst` (see `NotificationsService.markAsRead`). `id` is still a uuid, so it
  matches ≤1 row.
- **NEVER `prisma db push` OR `prisma db pull`** against an environment with partitioned
  tables. `push` would recreate them as plain tables; `pull` (introspection) cannot
  represent `PARTITION BY`, so it rewrites the model — dropping the partitioning contract
  and surfacing child partitions (`notifications_y2026m06`, `notifications_default`, …) as
  their own models. Use migrations only (`prisma migrate deploy`). The CI drift gate
  (below) fails the build if either ever diverges the schema from the DB.
- **CI drift gate:** `npm run prisma:drift-check` (`prisma migrate diff
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code`) must report
  *No difference* (exit 0). The composite-PK model keeps this clean; if it ever goes
  non-empty, a Prisma change is trying to un-partition a table — do not generate that
  migration.
- **Child DDL is owned by the `partition_*` routines + the maintenance scheduler, NOT
  Prisma.** Child partitions never appear in a Prisma migration.

## Maintenance (no pg_partman / pg_cron)

Worker-tier, Redis-coordinated repeatable scan in `src/partition-maintenance/` (mirrors
the stuck-delivery watchdog). Each tick, per table in `PARTITIONED_TABLES`:

1. `partition_drain_default(table)` — relocate any rows parked in the `DEFAULT` into
   proper monthly children (heals a maintenance lag / clock skew). **Runs first**: a bare
   `CREATE … PARTITION OF` fails when the `DEFAULT` already holds in-range rows, so the
   routine builds the child standalone, moves the rows, then `ATTACH`es.
2. `partition_ensure(table, PARTITION_MONTHS_AHEAD)` — create the current month + N future
   children so a new-month insert never falls to the `DEFAULT`.
3. `partition_drop_old(table, PARTITION_RETAIN_MONTHS)` — drop children entirely older than
   the retention window (no-op when `PARTITION_RETAIN_MONTHS=0`).

The permanent `DEFAULT` partition is the safety net: an insert can **never** fail with
"no partition found" even if maintenance lags.

### Env knobs (all optional)

| Var | Default | Meaning |
|-----|---------|---------|
| `PARTITION_MAINTENANCE_ENABLED` | `true` | kill-switch; `false` pauses + tears down the scheduler on next boot |
| `PARTITION_SCAN_INTERVAL_MS` | `21600000` (6h) | sweep cadence |
| `PARTITION_MONTHS_AHEAD` | `3` | future children kept ready (~90-day runway) |
| `PARTITION_RETAIN_MONTHS` | `0` | drop children older than N months; `0` = keep all |

### Metrics (Prometheus)

`drovery_partition_last_scan_timestamp_seconds` (heartbeat),
`drovery_partition_scheduler_registered`, `drovery_partition_default_rows{table}`
(**alert when > 0** — maintenance behind / window too short),
`drovery_partitions_created_total{table}`, `drovery_partitions_dropped_total{table}`.

## Verify (no data at scale)

```bash
# DB-level: routing, default-catch, drain-heal, retention. Non-destructive (rolls back).
psql "${DATABASE_URL%%\?*}" -v ON_ERROR_STOP=1 -f scripts/verify-partitions.sql
# Drift: schema vs DB must be clean.
npm run prisma:drift-check
# Service orchestration unit test:
npx jest src/partition-maintenance
```

## Adding a table

1. Pick an append-heavy, time-series table; check its inbound FKs (a leaf is easiest).
2. Change its model PK to `@@id([id, "createdAt"])`; fix any by-id `findUnique/update/delete`.
3. Hand-write a copy-swap migration mirroring `20260616120000_partition_notifications`.
4. Add the `@@map` name to `PARTITIONED_TABLES` (the `partition_*` routines are generic).
5. `prisma generate` → `npm run build` (compiler flags broken call-sites) → `migrate deploy`
   → `npm run prisma:drift-check` → `verify-partitions.sql`.

## At scale (populated table)

The reference migration backfills with a single `INSERT … SELECT` (fine for the current
small dataset). For a populated ~50M-row table, replace it with a **month-by-month batched
copy under a brief dual-write / maintenance window** — the same `partition_*` routines
provision the children; copy oldest→newest in batches, then cut over. Production drops
should use `DETACH PARTITION CONCURRENTLY` + archive before `DROP`.

## Next: the delivery graph

`deliveries` + 6 children (`delivery_tracking`, `payments`, `proof_of_delivery`,
`delivery_ratings`, `workflow_step_completions`, `drone_commands`). Two extra problems the
leaf `notifications` didn't have:

- **Global `trackingId` uniqueness** — a partitioned table can't enforce a unique that
  omits the partition key. Keep the existing collision-safe `trackingId` generator and add
  a small non-partitioned `trackingId` ledger for the global guarantee (or accept
  `UNIQUE(trackingId, "createdAt")` = per-window scope).
- **Composite-FK fan-out** — each child FK to `deliveries(id)` must become
  `(id, "createdAt")`, so every child needs a `deliveryCreatedAt` column backfilled from
  its parent and folded into the FK.
