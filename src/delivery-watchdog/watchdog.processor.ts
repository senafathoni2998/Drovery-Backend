import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { DeliveryWatchdog } from './delivery-watchdog';
import { REAP_JOB, WATCHDOG_QUEUE } from './watchdog.constants';

/**
 * Drains the watchdog queue: on each repeatable tick it runs the scan that reaps
 * stuck LIVE deliveries. Worker tier only (added to providers when RUN_PROCESSOR).
 */
@Processor(WATCHDOG_QUEUE)
export class WatchdogProcessor extends WorkerHost {
  private readonly logger = new Logger(WatchdogProcessor.name);

  constructor(private readonly watchdog: DeliveryWatchdog) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === REAP_JOB) {
      await this.watchdog.scanAndReap();
    }
  }
}
