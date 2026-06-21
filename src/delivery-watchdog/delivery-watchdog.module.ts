import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { DeliveryWatchdog } from './delivery-watchdog';
import { WATCHDOG_QUEUE } from './watchdog.constants';
import { WatchdogProcessor } from './watchdog.processor';
import { WatchdogScheduler } from './watchdog.scheduler';
import { IS_WORKER_TIER } from '../common/process-role';

// Both run on the worker tier only (api-only nodes register neither). The SCHEDULER
// is always registered there (mirrors RecurringScheduler) — NOT gated on the
// kill-switch — because it owns BOTH paths: upsert the repeatable scan when enabled,
// and tear down a previously-persisted scheduler when WATCHDOG_ENABLED=false (a
// flag-gated provider would never run that teardown). The PROCESSOR is likewise
// always registered on the worker so any reap job a prior enabled deploy left in
// Redis still drains. The DeliveryWatchdog service is always provided so it stays
// unit-testable regardless of tier/flag.
const RUN_PROCESSOR = IS_WORKER_TIER;

@Module({
  imports: [
    DeliveriesModule, // exports DeliveriesService (reused for failExceptional)
    BullModule.registerQueue({ name: WATCHDOG_QUEUE }),
  ],
  providers: [
    DeliveryWatchdog,
    ...(RUN_PROCESSOR ? [WatchdogProcessor, WatchdogScheduler] : []),
  ],
})
export class DeliveryWatchdogModule {}
