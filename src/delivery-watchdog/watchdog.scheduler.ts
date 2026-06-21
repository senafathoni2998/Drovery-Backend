import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { MetricsService } from '../metrics/metrics.service';
import {
  REAP_JOB,
  WATCHDOG_ENABLED,
  WATCHDOG_QUEUE,
  WATCHDOG_SCAN_INTERVAL_MS,
} from './watchdog.constants';

const SCHEDULER_ID = 'watchdog-reap';

// Only worker-tier nodes run the reaper (api-only nodes must not register it).
const RUN_PROCESSOR = process.env.PROCESS_ROLE !== 'api';

/**
 * Registers the repeatable reap scan. Uses BullMQ's job scheduler (idempotent by
 * id + Redis-coordinated), so N worker replicas + every restart converge on
 * EXACTLY ONE scheduler and exactly one worker runs each tick — mirrors
 * RecurringScheduler.
 */
@Injectable()
export class WatchdogScheduler implements OnModuleInit {
  private readonly logger = new Logger(WatchdogScheduler.name);

  constructor(
    @InjectQueue(WATCHDOG_QUEUE) private readonly queue: Queue,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!RUN_PROCESSOR) return; // api-only node — never touches the scheduler
    try {
      if (!WATCHDOG_ENABLED) {
        // Kill-switch flipped off: tear down a previously-persisted scheduler so it
        // stops producing reap jobs (the persisted scheduler survives restarts, so a
        // bare return would leave it running). The processor stays registered (module
        // gates it on RUN_PROCESSOR alone) so any in-flight job still drains.
        await this.queue.removeJobScheduler(SCHEDULER_ID);
        this.metrics.watchdogSchedulerRegistered.set(0);
        this.logger.warn(
          'Stuck-delivery watchdog DISABLED (WATCHDOG_ENABLED=false) — scheduler removed',
        );
        return;
      }
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: WATCHDOG_SCAN_INTERVAL_MS },
        {
          name: REAP_JOB,
          data: {},
          // Keep a bounded history (not removeOnComplete:true) so completed ticks
          // remain inspectable as a heartbeat via Bull Board / getCompleted().
          opts: {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
          },
        },
      );
      // Alertable: max(gauge)==0/absent across the worker fleet means no replica
      // registered the scheduler (e.g. every boot upsert below threw/hung).
      this.metrics.watchdogSchedulerRegistered.set(1);
      this.logger.log(
        `Stuck-delivery watchdog scheduled (every ${WATCHDOG_SCAN_INTERVAL_MS / 1000}s)`,
      );
    } catch (e) {
      // A Redis hiccup at boot must not crash the worker. NOTE: re-registration
      // only happens on the NEXT worker restart/deploy, not autonomously — the
      // scheduler-registered gauge (left at 0 here) surfaces a fleet-wide miss.
      this.metrics.watchdogSchedulerRegistered.set(0);
      this.logger.warn(
        `Failed to register watchdog scan: ${(e as Error).message}`,
      );
    }
  }
}
