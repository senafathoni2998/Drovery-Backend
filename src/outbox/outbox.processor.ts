import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { OutboxService } from './outbox.service';
import { OUTBOX_DISPATCH_JOB, OUTBOX_QUEUE } from './outbox.constants';

/**
 * Drains the outbox-dispatch queue: each repeatable tick reaps stale claims and applies a
 * batch of PENDING outbox events. Worker tier only (added to providers when
 * RUN_OUTBOX_DISPATCHER) — mirrors TrackingCheckpointProcessor.
 */
@Processor(OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  constructor(private readonly outbox: OutboxService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === OUTBOX_DISPATCH_JOB) {
      await this.outbox.dispatchDue();
    }
  }
}
