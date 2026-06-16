import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { PartitionMaintenanceService } from './partition-maintenance.service';
import { MAINTAIN_JOB, PARTITION_QUEUE } from './partition.constants';

/**
 * Drains the partition-maintenance queue: on each repeatable tick it runs the
 * drain/ensure/retention sweep over every partitioned table. Worker tier only (added
 * to providers when RUN_PROCESSOR).
 */
@Processor(PARTITION_QUEUE)
export class PartitionProcessor extends WorkerHost {
  private readonly logger = new Logger(PartitionProcessor.name);

  constructor(private readonly maintenance: PartitionMaintenanceService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === MAINTAIN_JOB) {
      await this.maintenance.run();
    }
  }
}
