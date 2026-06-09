import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';

import { SIM_QUEUE } from '../deliveries/simulation/simulation.constants';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

@Module({
  // Re-register the queue so MetricsService can @InjectQueue it. registerQueue
  // is idempotent per name and shares the BullModule.forRootAsync connection,
  // so this coexists with the DeliveriesModule registration.
  imports: [BullModule.registerQueue({ name: SIM_QUEUE })],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
