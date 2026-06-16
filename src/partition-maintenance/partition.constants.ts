export const PARTITION_QUEUE = 'partition-maintenance';
export const MAINTAIN_JOB = 'maintain';

// Kill-switch: ON by default (partitions must keep their forward window provisioned
// or new-month inserts would pile into the DEFAULT). Set PARTITION_MAINTENANCE_ENABLED
// =false to pause; read once at import, so toggling needs a worker restart, and on the
// disabled boot the scheduler tears down its persisted job (see PartitionScheduler).
export const PARTITION_MAINTENANCE_ENABLED =
  process.env.PARTITION_MAINTENANCE_ENABLED !== 'false';

// Scan cadence (default 6h). Partition windows move by the month, so this is far less
// frequent than the watchdog. Every numeric env is `Number(env) || default` so a
// malformed value can never become NaN.
export const PARTITION_SCAN_INTERVAL_MS =
  Number(process.env.PARTITION_SCAN_INTERVAL_MS) || 6 * 60 * 60_000;

// Months of FUTURE child partitions to keep ready (default 3 → ~90-day runway before
// the DEFAULT would ever be touched).
export const PARTITION_MONTHS_AHEAD =
  Number(process.env.PARTITION_MONTHS_AHEAD) || 3;

// Retention: drop child partitions entirely older than this many months. 0 (default)
// = retention DISABLED (keep all history) — opt in with a positive value.
export const PARTITION_RETAIN_MONTHS =
  Number(process.env.PARTITION_RETAIN_MONTHS) || 0;

// Tables under native RANGE("createdAt") partition management. Extend as the
// delivery-graph partitions land (see prisma/PARTITIONING.md). The plpgsql
// partition_* routines are table-parameterized, so adding a table here is enough.
export const PARTITIONED_TABLES: readonly string[] = ['notifications'];
