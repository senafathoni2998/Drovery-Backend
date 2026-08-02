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

// Tables under native RANGE partition management (the routines self-discover each
// table's partition column — "createdAt" for notifications/deliveries, "deliveryCreatedAt"
// for the two co-partitioned children). Extend as the delivery-graph partitions land
// (see prisma/PARTITIONING.md). Adding a table here is enough.
//
// ORDER MATTERS for retention COST (not correctness): the maintenance loop runs
// drain→ensure→drop_old per table in array order, so the co-partitioned children are
// listed BEFORE `deliveries`. Each aged child month is a bare O(1) DROP (no inbound FK);
// doing them first means fewer child rows remain for `deliveries`' O(rows) DELETE-cascade
// of the same month. (Dropping a child leaf is metadata-only and never fires the
// child→deliveries FK — that FK points the other way.)
export interface PartitionedTable {
  table: string;
  /**
   * Per-table retention override, in months. Falls back to the global
   * PARTITION_RETAIN_MONTHS when omitted. 0 means NEVER drop.
   *
   * This exists because the global knob is one setting for every table, and the only
   * table whose write rate would ever motivate enabling it is `flight_frames`. Without
   * an override, tuning telemetry retention silently deletes audit history too.
   */
  retainMonths?: number;
}

export const PARTITIONED_TABLES: readonly PartitionedTable[] = [
  { table: 'notifications' },
  { table: 'workflow_step_completions' },
  { table: 'drone_commands' },
  // The flight recorder — by far the highest-volume child (one row per telemetry
  // tick), so its aged months are the ones retention most needs to bare-DROP.
  { table: 'flight_frames' },
  // Operator actions. Partitioned for the convention and for read pruning, NOT so the
  // history can age out: retention is pinned OFF regardless of the global setting.
  { table: 'admin_audit_logs', retainMonths: 0 },
  { table: 'deliveries' },
];

/**
 * How many months of history a table keeps. A per-table `retainMonths` wins over the
 * global default INCLUDING an explicit 0 (never drop) — so `??`, never `||`. That single
 * character is the whole difference between "audit history is never dropped" and "it is
 * dropped whenever somebody tunes telemetry retention".
 */
export function retentionFor(
  entry: PartitionedTable,
  globalRetainMonths: number = PARTITION_RETAIN_MONTHS,
): number {
  return entry.retainMonths ?? globalRetainMonths;
}
