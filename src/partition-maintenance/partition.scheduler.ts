import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { MetricsService } from '../metrics/metrics.service';
import {
  MAINTAIN_JOB,
  PARTITION_MAINTENANCE_ENABLED,
  PARTITION_QUEUE,
  PARTITION_SCAN_INTERVAL_MS,
} from './partition.constants';

const SCHEDULER_ID = 'partition-maintain';

// Only worker-tier nodes run the maintenance sweep (api-only nodes must not register it).
const RUN_PROCESSOR = process.env.PROCESS_ROLE !== 'api';

/**
 * Registers the repeatable partition-maintenance scan via BullMQ's job scheduler
 * (idempotent by id + Redis-coordinated), so N worker replicas + every restart
 * converge on EXACTLY ONE scheduler and one worker runs each tick — mirrors
 * WatchdogScheduler/RecurringScheduler.
 */
@Injectable()
export class PartitionScheduler implements OnModuleInit {
  private readonly logger = new Logger(PartitionScheduler.name);

  constructor(
    @InjectQueue(PARTITION_QUEUE) private readonly queue: Queue,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!RUN_PROCESSOR) return; // api-only node — never touches the scheduler
    try {
      if (!PARTITION_MAINTENANCE_ENABLED) {
        // Kill-switch off: tear down a previously-persisted scheduler so it stops
        // producing maintenance jobs (the persisted scheduler survives restarts). The
        // processor stays registered (module gates it on RUN_PROCESSOR) so any in-flight
        // job still drains.
        await this.queue.removeJobScheduler(SCHEDULER_ID);
        this.metrics.partitionSchedulerRegistered.set(0);
        this.logger.warn(
          'Partition maintenance DISABLED (PARTITION_MAINTENANCE_ENABLED=false) — scheduler removed',
        );
        return;
      }
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: PARTITION_SCAN_INTERVAL_MS },
        {
          name: MAINTAIN_JOB,
          data: {},
          // Keep a bounded history (not removeOnComplete:true) so completed ticks
          // remain inspectable as a heartbeat.
          opts: {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
          },
        },
      );
      this.metrics.partitionSchedulerRegistered.set(1);
      this.logger.log(
        `Partition maintenance scheduled (every ${PARTITION_SCAN_INTERVAL_MS / 1000}s)`,
      );
    } catch (e) {
      // A Redis hiccup at boot must not crash the worker; the scheduler-registered
      // gauge (left at 0) surfaces a fleet-wide miss.
      this.metrics.partitionSchedulerRegistered.set(0);
      this.logger.warn(
        `Failed to register partition-maintenance scan: ${(e as Error).message}`,
      );
    }
  }
}
