import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';

import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { StorageModule } from '../storage/storage.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { ProofController } from './proof/proof.controller';
import { ProofService } from './proof/proof.service';
import { RatingController } from './rating/rating.controller';
import { RatingService } from './rating/rating.service';
import { SIM_QUEUE } from './simulation/simulation.constants';
import { SimulationProcessor } from './simulation/simulation.processor';
import { SimulationService } from './simulation/simulation.service';
import { TrackingGateway } from './tracking/tracking.gateway';
import { TrackingPublisher } from './tracking/tracking.publisher';
import { TrackingSubscriber } from './tracking/tracking.subscriber';
import { TrackingService } from './tracking/tracking.service';

// The queue consumer runs everywhere except API-only instances (PROCESS_ROLE=api).
const RUN_PROCESSOR = process.env.PROCESS_ROLE !== 'api';
// The WS gateway + Redis subscriber run wherever HTTP is served (NOT the worker).
const IS_API = process.env.PROCESS_ROLE !== 'worker';

@Module({
  imports: [
    NotificationsModule,
    GeoModule,
    PricingModule,
    PaymentsModule,
    StorageModule,
    ServiceabilityModule,
    PromoModule,
    BullModule.registerQueue({ name: SIM_QUEUE }),
    // JwtService for the WS gateway's handshake auth. AuthModule only exports
    // AuthService, so register Jwt here (same secret resolved from config).
    JwtModule.register({}),
  ],
  controllers: [DeliveriesController, ProofController, RatingController],
  providers: [
    DeliveriesService,
    ProofService,
    RatingService,
    SimulationService,
    TrackingService,
    // The worker publishes tracking updates to Redis; runs everywhere.
    TrackingPublisher,
    // The queue consumer (worker / dev), and the WS gateway + subscriber (api / dev).
    ...(RUN_PROCESSOR ? [SimulationProcessor] : []),
    ...(IS_API ? [TrackingGateway, TrackingSubscriber] : []),
  ],
  exports: [DeliveriesService, TrackingService, TrackingPublisher],
})
export class DeliveriesModule {}
