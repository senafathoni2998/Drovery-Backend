# Partitioning runbook

PostgreSQL native **time-range partitioning** for high-volume, append-heavy tables.
Today: **`notifications`** (the reference implementation). This doc is the operational
contract — read it before touching a partitioned table or the migration workflow.

## What's partitioned

| Table | Strategy | Key | Children |
|-------|----------|-----|----------|
| `notifications` | `RANGE("createdAt")` | composite PK `(id, "createdAt")` | monthly `notifications_yYYYYmMM` + a permanent `notifications_default` |
| `deliveries` | `RANGE("createdAt")` | composite PK `(id, "createdAt")` | monthly `deliveries_yYYYYmMM` + `deliveries_default` |

Migrations: `20260616120000_partition_notifications`, `20260619140000_partition_deliveries`.

**`deliveries` (delivery-graph Phase 1) is SHIPPED.** Because the parent PK is composite,
all 6 children (`delivery_tracking`, `payments`, `proof_of_delivery`, `delivery_ratings`,
`workflow_step_completions`, `drone_commands`) gained a `deliveryCreatedAt` column + a
**composite FK** to `deliveries(id, "createdAt")` — but they stay **plain (non-partitioned)**.
Global `trackingId` uniqueness lives in the non-partitioned **`tracking_id_registry`**
(written in `create()`'s tx; a dup throws P2002 → the existing collision-retry). `create()`
is now always-transactional; `findByTrackingId` resolves registry → composite-PK fetch;
~22 by-id `findUnique` reads became `findFirst`; child writes thread `deliveryCreatedAt`
(via the BullMQ job payloads for the worker path). **Phase 2 (deferred):** co-partition the
two N:1 children (`workflow_step_completions`, `drone_commands`) by `deliveryCreatedAt` —
needs the `partition_*` routines generalized to a per-table partition column. The 4 1:1
children stay plain indefinitely (bounded by delivery count, point-lookup reads).

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
   the retention window (no-op when `PARTITION_RETAIN_MONTHS=0`). For a **FK-referenced**
   parent like `deliveries` (6 children + `tracking_id_registry` all composite-FK `ON DELETE
   CASCADE`) a bare `DROP TABLE` of a leaf is **refused** by Postgres — each leaf carries the
   inbound-FK schema dependency. So the routine `DELETE`s the month's rows *through the parent*
   (firing the composite cascade into every child), then `DETACH PARTITION` + `DROP` the now
   unreferenced leaf. Equivalent (just a row-purge) for a childless parent like `notifications`.
   **At real scale that `DELETE` should be batched under a maintenance window** — dropping a
   month of `deliveries` also discards that month's payments/proofs/ratings/tracking + registry.

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

## Next: the delivery graph — build-ready plan (Phase 1)

`deliveries` + 6 children (`delivery_tracking`, `payments`, `proof_of_delivery`,
`delivery_ratings`, `workflow_step_completions`, `drone_commands`). This is the most
invasive DB change in the project (composite PK on the CENTRAL table), so it ships in
**one well-budgeted session** — do not start it piecemeal (a half-applied central-table
migration breaks the whole backend). The design below is decided and build-ready.

### Scope decision (Phase 1 vs deferred)

- **Phase 1 (this change):** partition **only `deliveries`** by `RANGE("createdAt")`
  (composite PK `(id, "createdAt")`). All 6 children stay **plain (non-partitioned)** but
  are FORCED to gain a `deliveryCreatedAt` column + a **composite FK** to
  `deliveries(id, "createdAt")` — because a Prisma relation must reference the parent's
  PK/unique, and the parent PK is now composite. Add a `tracking_id_registry` for global
  `trackingId` uniqueness.
- **Phase 2 (deferred):** co-partition the high-volume children
  (`workflow_step_completions`, `drone_commands`) by `deliveryCreatedAt`. The 1:1 children
  (tracking/payment/proof/rating) are bounded by delivery count → leave plain. This needs
  the `partition_*` routines generalized to a per-table partition column (they hardcode
  `"createdAt"`); trivial once Phase 1 lands.

Rationale: partitioning `deliveries` is the scaling win and the headline; the child FK
fan-out is unavoidable once the parent PK is composite, but actually *partitioning* the
children is gold-plating that multiplies migration risk 7×. Phase 1 delivers the win with
the smallest blast radius.

### The two hard problems

1. **Global `trackingId` uniqueness.** A partitioned table can't enforce a unique that
   omits the partition key. Drop `trackingId @unique` from `deliveries` (→ plain index) and
   add a NON-partitioned `tracking_id_registry (trackingId TEXT PRIMARY KEY, deliveryId
   TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL)`. In `create()`'s transaction, insert
   the registry row — a dup `trackingId` throws **P2002 on the registry PK**, so the
   existing collision-retry (`deliveries.service.ts` ~222-270, `MAX_TRACKING_ID_TRIES`)
   works unchanged (just point `isTrackingIdCollision` at the registry constraint).
   `findByTrackingId` (~500) resolves registry → `(deliveryId, "createdAt")` → fetch by the
   composite PK (or `findFirst({ where: { trackingId } })`).
2. **Composite-FK fan-out.** Each child gets `deliveryCreatedAt DateTime` +
   `@relation(fields: [deliveryId, deliveryCreatedAt], references: [id, createdAt], onDelete: Cascade)`.
   The 1:1 children keep `deliveryId @unique` (still globally unique → enforces 1:1);
   verify Prisma accepts the 1:1 with a composite relation (may need `@@unique([deliveryId, deliveryCreatedAt])`).

### Migration step order (single raw-SQL migration; FK drops gate the parent swap)

1. `CREATE TABLE tracking_id_registry …`; backfill `INSERT … SELECT "trackingId", id, "createdAt" FROM deliveries`.
2. For each child: `ADD COLUMN "deliveryCreatedAt" TIMESTAMP(3)`; backfill
   `UPDATE child c SET "deliveryCreatedAt" = d."createdAt" FROM deliveries d WHERE d.id = c."deliveryId"`; `SET NOT NULL`.
3. **Drop every child FK** to `deliveries(id)` (can't swap the parent while referenced).
4. **Copy-swap `deliveries`** exactly like `notifications` (rename → `LIKE … INCLUDING
   DEFAULTS` partitioned parent with composite PK → recreate the userId/status/trackingId
   indexes, `trackingId` now NON-unique → DEFAULT partition → backfill-through-DEFAULT +
   `partition_drain_default` → `partition_ensure(3)` → drop old). Recreate the `users` FK.
5. **Re-add each child's composite FK** `(deliveryId, deliveryCreatedAt) → deliveries(id, "createdAt") ON DELETE CASCADE`.
6. Add `'deliveries'` to `PARTITIONED_TABLES` (its partition col IS `"createdAt"`, so the
   existing `partition_*` routines work as-is for Phase 1).

### Code changes

- **schema.prisma:** `Delivery` → `@@id([id, "createdAt"])`, drop `trackingId @unique` (→
  `@@index([trackingId])`); add the 6 child `deliveryCreatedAt` + composite relations; add
  the `TrackingIdRegistry` model. `db push`/`db pull` stay forbidden (see top of this doc).
- **~22 by-id call sites** (`prisma.delivery.findUnique({ where: { id } })` no longer
  compiles): reads → `findFirst({ where: { id } })` (uuid ⇒ ≤1 row; correct, no pruning);
  the `update` at `deliveries.service.ts:590` → ownership/CAS `updateMany` or the
  `id_createdAt` composite. Files: admin.service(150,180), deliveries.service(482,503,552,
  590,622,645,727,738,789,865,908), drone-command.service(65,135), rating.service(49),
  simulation.processor(94,122,211), proof.service(87), telemetry.service(84), wallet.service(171).
- **Child writes must supply `deliveryCreatedAt`** (payments.service:143, workflows.service:52,
  drone-command.service:104, rating.service:27, tracking.service:44, proof.service:31,65):
  most already load the delivery (pass `delivery.createdAt`); the worker/telemetry/tracking
  paths carry only `deliveryId` in the BullMQ job data → **add `deliveryCreatedAt` to those
  job payloads** at enqueue (the create path has it), or a single cached lookup helper.

### Verification (no scale)

Extend `scripts/verify-partitions.sql`: a delivery routes to its month child (tableoid);
`DELETE` of a delivery cascades across the composite FK to all children; a duplicate
`trackingId` insert is rejected by the registry; `findByTrackingId` still resolves. Then
`npm run prisma:drift-check` (clean), the 580 jest suite (after the call-site rewrites), and
a live Prisma CRUD pass over the full graph (create → children → confirm-handoff → cancel).

### Top risks

- **Half-applied migration breaks the central table** → the migration is one transaction;
  never run it without budget to finish + verify in the same session.
- **A missed by-id call site** → the regenerated client makes it a COMPILE error (id is no
  longer a unique-where), so `npm run build` is the backstop — fix every one before commit.
- **Child write missing `deliveryCreatedAt`** → a NOT NULL / FK violation at runtime; the
  job-payload threading + a compile check on the child `create` inputs catch it.
