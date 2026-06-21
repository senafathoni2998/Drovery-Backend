import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { RECUR_QUEUE } from './recurring.constants';
import { RecurringDeliveriesController } from './recurring-deliveries.controller';
import { RecurringDeliveriesService } from './recurring-deliveries.service';
import { RecurringMaterializer } from './recurring.materializer';
import { RecurringProcessor } from './recurring.processor';
import { RecurringScheduler } from './recurring.scheduler';
import { IS_WORKER_TIER } from '../common/process-role';

// The materialization processor + scan scheduler run on the worker tier (NOT api/realtime).
const RUN_PROCESSOR = IS_WORKER_TIER;

@Module({
  imports: [
    DeliveriesModule, // exports DeliveriesService (reused by the materializer)
    BullModule.registerQueue({ name: RECUR_QUEUE }),
  ],
  controllers: [RecurringDeliveriesController],
  providers: [
    RecurringDeliveriesService,
    RecurringMaterializer,
    RecurringScheduler,
    ...(RUN_PROCESSOR ? [RecurringProcessor] : []),
  ],
})
export class RecurringDeliveriesModule {}
