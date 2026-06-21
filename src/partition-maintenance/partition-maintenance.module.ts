import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PartitionMaintenanceService } from './partition-maintenance.service';
import { PARTITION_QUEUE } from './partition.constants';
import { PartitionProcessor } from './partition.processor';
import { PartitionScheduler } from './partition.scheduler';
import { IS_WORKER_TIER } from '../common/process-role';

// Worker tier only (api/realtime nodes register neither processor nor scheduler). The
// SCHEDULER is always registered there (mirrors WatchdogScheduler) — NOT gated on the
// kill-switch — because it owns BOTH paths: upsert the repeatable scan when enabled, and
// tear down a previously-persisted scheduler when disabled. The PROCESSOR is likewise
// always registered so any maintenance job a prior enabled deploy left in Redis drains.
// PrismaService + MetricsService are global, so only the queue needs registering.
const RUN_PROCESSOR = IS_WORKER_TIER;

@Module({
  imports: [BullModule.registerQueue({ name: PARTITION_QUEUE })],
  providers: [
    PartitionMaintenanceService,
    ...(RUN_PROCESSOR ? [PartitionProcessor, PartitionScheduler] : []),
  ],
})
export class PartitionMaintenanceModule {}
