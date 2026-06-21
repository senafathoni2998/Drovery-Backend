import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { TrackingHotStore } from './tracking-hot-store';
import {
  CHECKPOINT_JOB,
  TRACKING_CHECKPOINT_QUEUE,
} from './tracking-hot-store.constants';

/**
 * Drains the tracking-checkpoint queue: each repeatable tick flushes the dirty
 * deliveries' latest hot-store positions into Postgres. Worker tier only (added to
 * providers when RUN_PROCESSOR).
 */
@Processor(TRACKING_CHECKPOINT_QUEUE)
export class TrackingCheckpointProcessor extends WorkerHost {
  constructor(private readonly hotStore: TrackingHotStore) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === CHECKPOINT_JOB) {
      await this.hotStore.drainCheckpoints();
    }
  }
}
