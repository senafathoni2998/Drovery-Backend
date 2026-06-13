import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';

import { SIM_QUEUE } from '../deliveries/simulation/simulation.constants';
import { RECUR_QUEUE } from '../recurring-deliveries/recurring.constants';
import { WATCHDOG_QUEUE } from '../delivery-watchdog/watchdog.constants';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

// Global so MetricsService injects anywhere (e.g. the TrackingGateway's
// ws-connection gauge) without each feature module re-importing this module.
@Global()
@Module({
  // Re-register every queue MetricsService reads depth from so it can @InjectQueue
  // them. registerQueue is idempotent per name and shares the
  // BullModule.forRootAsync connection, so this coexists with each feature
  // module's own registration (Deliveries/Recurring/Watchdog).
  imports: [
    BullModule.registerQueue(
      { name: SIM_QUEUE },
      { name: RECUR_QUEUE },
      { name: WATCHDOG_QUEUE },
    ),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
