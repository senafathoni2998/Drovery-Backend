import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { OrphanReaperService } from './orphan-reaper.service';
import {
  ORPHAN_REAPER_QUEUE,
  ORPHAN_REAPER_SWEEP_JOB,
} from './orphan-reaper.constants';

/**
 * Drains the orphan-reaper queue: each repeatable tick reconciles orphaned debit-first
 * reservations. Worker tier only (added to providers when RUN_ORPHAN_REAPER) — mirrors
 * TrackingCheckpointProcessor / OutboxProcessor.
 */
@Processor(ORPHAN_REAPER_QUEUE)
export class OrphanReaperProcessor extends WorkerHost {
  constructor(private readonly reaper: OrphanReaperService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === ORPHAN_REAPER_SWEEP_JOB) {
      await this.reaper.sweep();
    }
  }
}
