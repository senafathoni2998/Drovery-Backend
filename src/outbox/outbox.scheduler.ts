import { Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { MetricsService } from '../metrics/metrics.service';
import {
  OUTBOX_DISPATCH_ENABLED,
  OUTBOX_DISPATCH_INTERVAL_MS,
  OUTBOX_DISPATCH_JOB,
  OUTBOX_QUEUE,
  RUN_OUTBOX_DISPATCHER,
} from './outbox.constants';

const SCHEDULER_ID = 'outbox-dispatch';

/**
 * Registers the repeatable outbox-dispatch scan via BullMQ's job scheduler (idempotent by
 * id + Redis-coordinated, so N worker replicas + every restart converge on one scheduler
 * and one worker runs each tick) — mirrors WatchdogScheduler / TrackingCheckpointScheduler.
 * Owns both paths: upsert when the dispatcher is enabled, tear down a previously-persisted
 * scheduler when disabled (so the kill-switch actually stops the drain).
 */
@Injectable()
export class OutboxScheduler implements OnModuleInit {
  private readonly logger = new Logger(OutboxScheduler.name);

  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!RUN_OUTBOX_DISPATCHER) return;
    try {
      if (!OUTBOX_DISPATCH_ENABLED) {
        await this.queue.removeJobScheduler(SCHEDULER_ID);
        return;
      }
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: OUTBOX_DISPATCH_INTERVAL_MS },
        {
          name: OUTBOX_DISPATCH_JOB,
          data: {},
          opts: {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
          },
        },
      );
      this.metrics?.outboxSchedulerRegistered.set(1);
      this.logger.log(
        `Outbox dispatcher scheduled (every ${OUTBOX_DISPATCH_INTERVAL_MS / 1000}s)`,
      );
    } catch (e) {
      this.logger.warn(
        `Failed to register outbox dispatcher: ${(e as Error).message}`,
      );
    }
  }
}
