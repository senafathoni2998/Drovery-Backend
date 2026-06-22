import { Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { MetricsService } from '../../metrics/metrics.service';
import {
  ORPHAN_REAPER_QUEUE,
  ORPHAN_REAPER_SWEEP_INTERVAL_MS,
  ORPHAN_REAPER_SWEEP_JOB,
  RUN_ORPHAN_REAPER,
} from './orphan-reaper.constants';

const SCHEDULER_ID = 'orphan-reservation-reaper';

/**
 * Registers the repeatable orphan-reservation sweep via BullMQ's job scheduler (idempotent by
 * id + Redis-coordinated, so N worker replicas + every restart converge on one scheduler) —
 * mirrors WatchdogScheduler / OutboxScheduler. Only registered when RUN_ORPHAN_REAPER (worker
 * tier AND DELIVERY_DEBIT_FIRST on), so it is inert by default; tears down a previously
 * persisted scheduler when the gate is off so flipping the saga off stops the sweep.
 */
@Injectable()
export class OrphanReaperScheduler implements OnModuleInit {
  private readonly logger = new Logger(OrphanReaperScheduler.name);

  constructor(
    @InjectQueue(ORPHAN_REAPER_QUEUE) private readonly queue: Queue,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      if (!RUN_ORPHAN_REAPER) {
        await this.queue.removeJobScheduler(SCHEDULER_ID);
        return;
      }
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: ORPHAN_REAPER_SWEEP_INTERVAL_MS },
        {
          name: ORPHAN_REAPER_SWEEP_JOB,
          data: {},
          opts: {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
          },
        },
      );
      this.metrics?.orphanReaperSchedulerRegistered.set(1);
      this.logger.log(
        `Orphan-reservation reaper scheduled (every ${ORPHAN_REAPER_SWEEP_INTERVAL_MS / 1000}s)`,
      );
    } catch (e) {
      this.logger.warn(
        `Failed to register orphan-reservation reaper: ${(e as Error).message}`,
      );
    }
  }
}
