import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { WalletModule } from '../wallet/wallet.module';
import { OutboxProcessor } from './outbox.processor';
import { OutboxScheduler } from './outbox.scheduler';
import { OutboxService } from './outbox.service';
import { OUTBOX_QUEUE, RUN_OUTBOX_DISPATCHER } from './outbox.constants';

/**
 * Transactional outbox (SCALING-1M.md §2). OutboxService.enqueueWithinTx runs on EVERY tier
 * (producers — e.g. DeliveriesService.create — call it), so it is provided + exported here.
 * The dispatcher (Processor + Scheduler) runs on the WORKER tier only (mirrors
 * TrackingCheckpointModule). WalletModule supplies the referral-reward handler dependency;
 * MetricsService is @Global so the dispatcher's gauges resolve without an import.
 */
@Module({
  imports: [
    WalletModule, // exports WalletService (the referral-reward handler)
    BullModule.registerQueue({ name: OUTBOX_QUEUE }),
  ],
  providers: [
    OutboxService,
    ...(RUN_OUTBOX_DISPATCHER ? [OutboxProcessor, OutboxScheduler] : []),
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
