import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  CHECKPOINT_ENABLED,
  CHECKPOINT_INTERVAL_MS,
  CHECKPOINT_JOB,
  TRACKING_CHECKPOINT_QUEUE,
  TRACKING_HOT_STORE_ENABLED,
} from './tracking-hot-store.constants';
import { IS_WORKER_TIER } from '../../common/process-role';

const SCHEDULER_ID = 'tracking-checkpoint';
// Only worker-tier nodes drain the hot store (api/realtime nodes must not register it).
const RUN_PROCESSOR = IS_WORKER_TIER;

/**
 * Registers the repeatable checkpoint scan via BullMQ's job scheduler (idempotent by
 * id + Redis-coordinated, so N worker replicas + every restart converge on exactly
 * one scheduler and one worker runs each tick) — mirrors WatchdogScheduler. Owns BOTH
 * paths: upsert the scan when the hot-store is enabled, and tear down a
 * previously-persisted scheduler when it's disabled (so flipping the flag off stops
 * the drain instead of leaving an orphaned repeatable job).
 */
@Injectable()
export class TrackingCheckpointScheduler implements OnModuleInit {
  private readonly logger = new Logger(TrackingCheckpointScheduler.name);

  constructor(
    @InjectQueue(TRACKING_CHECKPOINT_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!RUN_PROCESSOR) return;
    try {
      if (!TRACKING_HOT_STORE_ENABLED || !CHECKPOINT_ENABLED) {
        await this.queue.removeJobScheduler(SCHEDULER_ID);
        return;
      }
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: CHECKPOINT_INTERVAL_MS },
        {
          name: CHECKPOINT_JOB,
          data: {},
          opts: {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
          },
        },
      );
      this.logger.log(
        `Tracking checkpoint scheduled (every ${CHECKPOINT_INTERVAL_MS / 1000}s)`,
      );
    } catch (e) {
      this.logger.warn(
        `Failed to register tracking checkpoint scan: ${(e as Error).message}`,
      );
    }
  }
}
