import { Injectable, Logger } from '@nestjs/common';

import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PARTITIONED_TABLES,
  PARTITION_MONTHS_AHEAD,
  PARTITION_RETAIN_MONTHS,
} from './partition.constants';

/**
 * Keeps every time-range-partitioned table provisioned: each tick it (1) drains any
 * rows parked in the DEFAULT partition into proper monthly children (heals a
 * maintenance lag / clock skew), (2) ensures the forward window of children exists so
 * a new-month insert never falls to the DEFAULT, and (3) optionally drops children past
 * the retention window. All work runs through the table-parameterized plpgsql routines
 * (partition_drain_default / partition_ensure / partition_drop_old) on the PRIMARY (DDL
 * must not go to a read replica). Per-table try/catch so one table can't fail the tick;
 * multi-replica safe because the scheduler runs exactly one tick at a time and the SQL
 * is idempotent (IF-NOT-EXISTS create, bounded drop).
 */
@Injectable()
export class PartitionMaintenanceService {
  private readonly logger = new Logger(PartitionMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async run(): Promise<void> {
    for (const table of PARTITIONED_TABLES) {
      try {
        const drained = await this.callFn('partition_drain_default', table);
        const created = await this.callFn(
          'partition_ensure',
          table,
          PARTITION_MONTHS_AHEAD,
        );
        const dropped =
          PARTITION_RETAIN_MONTHS > 0
            ? await this.callFn(
                'partition_drop_old',
                table,
                PARTITION_RETAIN_MONTHS,
              )
            : 0;

        if (created + drained > 0)
          this.metrics.partitionsCreatedTotal.inc({ table }, created + drained);
        if (dropped > 0)
          this.metrics.partitionsDroppedTotal.inc({ table }, dropped);

        this.logger.log(
          `partition-maintenance ${table}: drained=${drained} created=${created} dropped=${dropped}`,
        );
      } catch (e) {
        // One bad table must never fail the whole tick (BullMQ would retry the scan
        // and re-process every table). But the swallow must be OBSERVABLE: a retention
        // DELETE/DROP that fails here would otherwise reclaim nothing silently (aged rows
        // sit in month leaves, NOT the watched DEFAULT) — alert on this counter.
        this.metrics.partitionMaintenanceFailures.inc({ table });
        this.logger.warn(
          `partition-maintenance ${table} failed: ${(e as Error).message}`,
        );
      }

      // Retention-lag signal, independent of the DEFAULT: the age of the oldest monthly
      // child. With retention enabled this stays ≤ PARTITION_RETAIN_MONTHS; if it climbs,
      // drop_old is failing/no-op-ing (the failure above may be swallowed). Own try so a
      // read error can't fail the tick.
      try {
        this.metrics.partitionOldestLeafAgeMonths.set(
          { table },
          await this.oldestLeafAgeMonths(table),
        );
      } catch (e) {
        this.logger.warn(
          `partition-maintenance ${table} oldest-leaf read failed: ${(e as Error).message}`,
        );
      }

      // Read the default-rows gauge in its OWN try, so a drain/ensure failure above
      // can't leave this (authoritative) failure signal stale: rows still parked in
      // the DEFAULT mean maintenance is behind or the forward window is too short —
      // alert on drovery_partition_default_rows > 0.
      try {
        this.metrics.partitionDefaultRows.set(
          { table },
          await this.countDefault(table),
        );
      } catch (e) {
        this.logger.warn(
          `partition-maintenance ${table} default-rows read failed: ${(e as Error).message}`,
        );
      }
    }

    // Liveness heartbeat: advances every tick the worker actually runs (per-table
    // failures are isolated above and do NOT hold it back). So `time() - last_scan > N`
    // detects a DEAD sweep (processor/Redis/worker down), NOT a per-table failure —
    // the authoritative per-table failure signal is drovery_partition_default_rows > 0.
    this.metrics.partitionLastScan.set(Date.now() / 1000);
  }

  /** Call a `partition_*(table[, n])` routine on the PRIMARY; returns its int result. */
  private async callFn(fn: string, table: string, n?: number): Promise<number> {
    // The table name is a parameter to the plpgsql routine (which %I-quotes it); the
    // function NAME is from a fixed allowlist of literals above — never user input.
    const rows =
      n === undefined
        ? await this.prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
            `SELECT ${fn}($1) AS n`,
            table,
          )
        : await this.prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
            `SELECT ${fn}($1, $2) AS n`,
            table,
            n,
          );
    return Number(rows?.[0]?.n ?? 0);
  }

  /** Age in months of the oldest non-DEFAULT monthly child of `table` (0 if none). The
   * month is read from the child name (…_yYYYYmMM); `table` is from the hardcoded
   * allowlist and is also passed as a bound parameter to the catalog lookups. */
  private async oldestLeafAgeMonths(table: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ n: number | bigint }>
    >(
      `SELECT COALESCE(MAX(
         (EXTRACT(YEAR FROM now()) - EXTRACT(YEAR FROM m)) * 12
         + (EXTRACT(MONTH FROM now()) - EXTRACT(MONTH FROM m))), 0)::int AS n
       FROM (
         SELECT to_date(substring(c.relname FROM '(y[0-9]{4}m[0-9]{2})$'), '"y"YYYY"m"MM') AS m
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = to_regclass('public.' || quote_ident($1))
           AND c.relname ~ ('^' || $1 || '_y[0-9]{4}m[0-9]{2}$')
       ) leaves`,
      table,
    );
    return Number(rows?.[0]?.n ?? 0);
  }

  private async countDefault(table: string): Promise<number> {
    // `table` is from the hardcoded PARTITIONED_TABLES allowlist (not user input), so
    // interpolating it into the identifier is safe; count(*)::int returns a JS number.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ n: number | bigint }>
    >(`SELECT count(*)::int AS n FROM "${table}_default"`);
    return Number(rows?.[0]?.n ?? 0);
  }
}
