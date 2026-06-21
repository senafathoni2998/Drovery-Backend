import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { MATERIALIZE_JOB, RECUR_QUEUE } from './recurring.constants';
import { RecurringMaterializer } from './recurring.materializer';

/**
 * Drains the recurring-materialize queue: on each repeatable tick it runs the
 * scan that turns due schedules into deliveries. Runs in the worker tier (added
 * to providers only when RUN_PROCESSOR).
 */
@Processor(RECUR_QUEUE)
export class RecurringProcessor extends WorkerHost {
  private readonly logger = new Logger(RecurringProcessor.name);

  constructor(private readonly materializer: RecurringMaterializer) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === MATERIALIZE_JOB) {
      await this.materializer.scanAndMaterialize();
    }
  }
}
