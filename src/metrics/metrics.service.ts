import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import { WATCHDOG_QUEUE } from '../delivery-watchdog/watchdog.constants';
import { PARTITION_QUEUE } from '../partition-maintenance/partition.constants';
import { SIM_QUEUE } from '../deliveries/simulation/simulation.constants';
import { RECUR_QUEUE } from '../recurring-deliveries/recurring.constants';

/** Reject after `ms` so a hung Redis call can't stall the /metrics scrape. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('metrics collect timed out')),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Owns a single Prometheus registry and the app's metrics. Exposed at
 * GET /api/v1/metrics (API) and :METRICS_PORT/metrics (worker).
 *
 * The queue-depth gauge is collected ON SCRAPE (not on a timer), so it never
 * drifts and costs nothing while idle. getJobCounts() is queue-global, so every
 * replica exports the SAME value — the KEDA worker autoscaler therefore queries
 * with max(), not sum(), to avoid multiplying the backlog by the replica count.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<string>;
  readonly httpTotal: Counter<string>;
  readonly wsConnections: Gauge<string>;
  readonly wsSupportConnections: Gauge<string>;
  // Stuck-delivery watchdog (worker tier): reap counter + heartbeat gauges so the
  // safety reaper is observable/alertable — a silent scheduler/processor death is
  // otherwise invisible. last-scan drives `time() - gauge > N`; scheduler-registered
  // drives `max(gauge) == 0` (or absent) across the worker fleet.
  readonly watchdogReapedTotal: Counter<string>;
  readonly watchdogLastScan: Gauge<string>;
  readonly watchdogSchedulerRegistered: Gauge<string>;
  // Backend→drone command channel (money-touching control path on LIVE deliveries).
  readonly droneCommandsTotal: Counter<string>;
  readonly droneCommandTimeToAck: Histogram<string>;
  // Partition maintenance (worker tier): heartbeat + scheduler gauges (mirroring the
  // watchdog), per-table created/dropped counters, and a default-rows gauge that
  // alerts when rows pile in the DEFAULT partition (maintenance lag / short window).
  readonly partitionLastScan: Gauge<string>;
  readonly partitionSchedulerRegistered: Gauge<string>;
  readonly partitionDefaultRows: Gauge<string>;
  readonly partitionsCreatedTotal: Counter<string>;
  readonly partitionsDroppedTotal: Counter<string>;
  // Retention observability: a per-table tick failure is swallowed (to isolate one table),
  // so without these signals a broken retention reclaims nothing SILENTLY (aged rows hide in
  // month leaves, not the watched DEFAULT). The counter makes the swallow alertable; the
  // gauge is the authoritative retention-lag signal (oldest non-DEFAULT child age).
  readonly partitionMaintenanceFailures: Counter<string>;
  readonly partitionOldestLeafAgeMonths: Gauge<string>;

  constructor(
    @InjectQueue(SIM_QUEUE) simQueue: Queue,
    @InjectQueue(RECUR_QUEUE) recurQueue: Queue,
    @InjectQueue(WATCHDOG_QUEUE) watchdogQueue: Queue,
    @InjectQueue(PARTITION_QUEUE) partitionQueue: Queue,
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: 'drovery_' });

    this.httpDuration = new Histogram({
      name: 'drovery_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      // Labelled by route TEMPLATE (e.g. /api/v1/deliveries/:id), never the raw
      // URL — labelling raw paths is an unbounded-cardinality trap.
      labelNames: ['method', 'status', 'route'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.httpTotal = new Counter({
      name: 'drovery_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'status', 'route'],
      registers: [this.registry],
    });

    this.wsConnections = new Gauge({
      name: 'drovery_ws_connections',
      help: 'Currently connected tracking WebSocket clients',
      registers: [this.registry],
    });

    this.wsSupportConnections = new Gauge({
      name: 'drovery_ws_support_connections',
      help: 'Currently connected support-chat WebSocket clients',
      registers: [this.registry],
    });

    this.watchdogReapedTotal = new Counter({
      name: 'drovery_watchdog_reaped_total',
      help: 'Stuck LIVE deliveries reaped to DELIVERY_FAILED by the watchdog',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.watchdogLastScan = new Gauge({
      name: 'drovery_watchdog_last_scan_timestamp_seconds',
      help: 'Unix time the watchdog last COMPLETED a reap scan (heartbeat)',
      registers: [this.registry],
    });

    this.watchdogSchedulerRegistered = new Gauge({
      name: 'drovery_watchdog_scheduler_registered',
      help: '1 when this replica registered the watchdog repeatable scheduler',
      registers: [this.registry],
    });

    this.droneCommandsTotal = new Counter({
      name: 'drovery_drone_commands_total',
      help: 'Backend→drone commands by type and result',
      // result ∈ issued | fetched | acked | superseded | rejected | expired.
      // `type` is always a real DroneCommandType (RETURN_TO_BASE | ABORT) — the
      // watchdog expiry sweep increments per-type, never a synthetic aggregate.
      labelNames: ['type', 'result'],
      registers: [this.registry],
    });

    this.droneCommandTimeToAck = new Histogram({
      name: 'drovery_drone_command_time_to_ack_seconds',
      help: 'Seconds from a drone command being issued to the drone responding (by result)',
      // result-labelled so refusal/superseded latency does not skew true-ack p95.
      labelNames: ['type', 'result'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    this.partitionLastScan = new Gauge({
      name: 'drovery_partition_last_scan_timestamp_seconds',
      help: 'Unix time partition maintenance last COMPLETED a sweep (heartbeat)',
      registers: [this.registry],
    });

    this.partitionSchedulerRegistered = new Gauge({
      name: 'drovery_partition_scheduler_registered',
      help: '1 when this replica registered the partition-maintenance scheduler',
      registers: [this.registry],
    });

    this.partitionDefaultRows = new Gauge({
      name: 'drovery_partition_default_rows',
      help: 'Rows currently parked in a table DEFAULT partition (should be ~0; alert if >0)',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.partitionsCreatedTotal = new Counter({
      name: 'drovery_partitions_created_total',
      help: 'Child partitions created (ensured + drained) per table',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.partitionsDroppedTotal = new Counter({
      name: 'drovery_partitions_dropped_total',
      help: 'Child partitions dropped by retention per table',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.partitionMaintenanceFailures = new Counter({
      name: 'drovery_partition_maintenance_failures_total',
      help: 'Per-table partition-maintenance tick failures (swallowed to isolate one table); alert if increasing',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.partitionOldestLeafAgeMonths = new Gauge({
      name: 'drovery_partition_oldest_leaf_age_months',
      help: 'Age in months of the oldest non-DEFAULT child partition (retention-lag signal; alert if > PARTITION_RETAIN_MONTHS when retention is enabled)',
      labelNames: ['table'],
      registers: [this.registry],
    });

    // Every BullMQ queue we want backlog/failed visibility on. getJobCounts is
    // queue-global, so every replica exports the SAME value (KEDA queries with
    // max(), not sum()). Each queue is collected independently so one slow/offline
    // queue can't blank the others.
    const queues: Array<{ name: string; queue: Queue }> = [
      { name: SIM_QUEUE, queue: simQueue },
      { name: RECUR_QUEUE, queue: recurQueue },
      { name: WATCHDOG_QUEUE, queue: watchdogQueue },
      { name: PARTITION_QUEUE, queue: partitionQueue },
    ];
    new Gauge({
      name: 'drovery_queue_jobs',
      help: 'BullMQ job counts by state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      async collect() {
        for (const { name, queue } of queues) {
          try {
            // Bound the call: the BullMQ connection uses maxRetriesPerRequest:null +
            // an offline queue, so getJobCounts() HANGS (doesn't reject) when Redis
            // is down. Without this race the whole /metrics scrape would hang.
            const counts = await withTimeout(
              queue.getJobCounts(
                'waiting',
                'active',
                'delayed',
                'completed',
                'failed',
              ),
              1000,
            );
            for (const [state, value] of Object.entries(counts)) {
              this.set({ queue: name, state }, value);
            }
          } catch {
            // Redis/queue unavailable or slow — skip THIS queue for this scrape
            // rather than hanging or failing the WHOLE /metrics response (the rest of
            // the registry still renders, so Prometheus keeps visibility).
          }
        }
      },
    });
  }

  /** Prometheus exposition text (0.0.4). */
  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
