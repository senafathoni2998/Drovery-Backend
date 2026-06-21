import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { DeliveriesModule } from '../deliveries.module';
import { TrackingCheckpointProcessor } from './tracking-checkpoint.processor';
import { TrackingCheckpointScheduler } from './tracking-checkpoint.scheduler';
import {
  TRACKING_CHECKPOINT_QUEUE,
  assertCheckpointSafe,
} from './tracking-hot-store.constants';
import { IS_WORKER_TIER } from '../../common/process-role';

// Fail the boot LOUD (on any tier) if the hot-store is enabled with an unsafe
// checkpoint cadence — checkpoint lag past the watchdog silence window would
// false-reap live drones.
assertCheckpointSafe();

// The checkpoint scan runs on the worker tier only (mirrors the watchdog). The
// scheduler is registered there because it owns both the upsert-when-enabled and the
// tear-down-when-disabled paths; the processor so any job a prior enabled deploy left
// in Redis still drains. TrackingHotStore (the producer/reader) is provided by
// DeliveriesModule and runs everywhere.
const RUN_PROCESSOR = IS_WORKER_TIER;

@Module({
  imports: [
    DeliveriesModule, // exports TrackingHotStore
    BullModule.registerQueue({ name: TRACKING_CHECKPOINT_QUEUE }),
  ],
  providers: [
    ...(RUN_PROCESSOR
      ? [TrackingCheckpointProcessor, TrackingCheckpointScheduler]
      : []),
  ],
})
export class TrackingCheckpointModule {}
