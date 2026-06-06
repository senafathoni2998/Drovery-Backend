import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { StorageModule } from '../storage/storage.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { ProofController } from './proof/proof.controller';
import { ProofService } from './proof/proof.service';
import { SIM_QUEUE } from './simulation/simulation.constants';
import { SimulationProcessor } from './simulation/simulation.processor';
import { SimulationService } from './simulation/simulation.service';
import { TrackingGateway } from './tracking/tracking.gateway';
import { TrackingService } from './tracking/tracking.service';

@Module({
  imports: [
    NotificationsModule,
    GeoModule,
    PricingModule,
    PaymentsModule,
    StorageModule,
    BullModule.registerQueue({ name: SIM_QUEUE }),
  ],
  controllers: [DeliveriesController, ProofController],
  providers: [
    DeliveriesService,
    ProofService,
    SimulationService,
    SimulationProcessor,
    TrackingService,
    TrackingGateway,
  ],
  exports: [DeliveriesService, TrackingService],
})
export class DeliveriesModule {}
