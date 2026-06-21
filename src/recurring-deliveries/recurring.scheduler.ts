import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  MATERIALIZE_JOB,
  RECUR_QUEUE,
  SCAN_INTERVAL_MS,
} from './recurring.constants';
import { IS_WORKER_TIER } from '../common/process-role';

// Only worker-tier nodes register the scan (api/realtime nodes must not).
const RUN_PROCESSOR = IS_WORKER_TIER;

/**
 * Registers the repeatable materialization scan. Uses BullMQ's job scheduler,
 * which is idempotent by id and Redis-coordinated — so N worker replicas plus
 * every restart converge on EXACTLY ONE scheduler (no stale repeat-key buildup),
 * and exactly one worker runs each tick.
 */
@Injectable()
export class RecurringScheduler implements OnModuleInit {
  private readonly logger = new Logger(RecurringScheduler.name);

  constructor(@InjectQueue(RECUR_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!RUN_PROCESSOR) return;
    try {
      await this.queue.upsertJobScheduler(
        'recur-materialize',
        { every: SCAN_INTERVAL_MS },
        {
          name: MATERIALIZE_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: { count: 100 } },
        },
      );
      this.logger.log(
        `Recurring materialization scan scheduled (every ${SCAN_INTERVAL_MS / 1000}s)`,
      );
    } catch (e) {
      // A Redis hiccup at boot must not crash the worker — it keeps draining
      // other queues; the scheduler re-upserts on the next boot.
      this.logger.warn(
        `Failed to register recurring scan: ${(e as Error).message}`,
      );
    }
  }
}
