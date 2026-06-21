import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';

import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { WalletModule } from '../wallet/wallet.module';
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
import { TrackingHotStore } from './tracking/tracking-hot-store';
import { DroneAuthGuard } from './telemetry/drone-auth.guard';
import { MqttTelemetrySubscriber } from './telemetry/mqtt-telemetry.subscriber';
import { MqttCommandAckSubscriber } from './commands/mqtt-command-ack.subscriber';
import { TelemetryController } from './telemetry/telemetry.controller';
import { TelemetryService } from './telemetry/telemetry.service';
import { CommandController } from './commands/command.controller';
import { DroneCommandService } from './commands/drone-command.service';
import {
  IS_HTTP_TIER,
  IS_INGEST_TIER,
  IS_WORKER_TIER,
} from '../common/process-role';

// The sim queue consumer runs on the worker tier only (NOT api/realtime).
const RUN_PROCESSOR = IS_WORKER_TIER;

@Module({
  imports: [
    NotificationsModule,
    GeoModule,
    PricingModule,
    PaymentsModule,
    StorageModule,
    ServiceabilityModule,
    PromoModule,
    WalletModule,
    BullModule.registerQueue({ name: SIM_QUEUE }),
    // JwtService for the WS gateway's handshake auth. AuthModule only exports
    // AuthService, so register Jwt here (same secret resolved from config).
    JwtModule.register({}),
  ],
  controllers: [
    DeliveriesController,
    ProofController,
    RatingController,
    TelemetryController,
    CommandController,
  ],
  providers: [
    DeliveriesService,
    ProofService,
    RatingService,
    SimulationService,
    TrackingService,
    // Hot-store for the high-frequency position write (inert unless TRACKING_HOT_STORE=redis).
    TrackingHotStore,
    // The worker publishes tracking updates to Redis; runs everywhere.
    TrackingPublisher,
    // Live drone telemetry ingest core (transport-agnostic) + its gateway auth.
    TelemetryService,
    DroneAuthGuard,
    // Backend → drone command outbox (issue/poll/ack). Provided on every tier so
    // AdminService (api) and the controller can reuse it.
    DroneCommandService,
    // The sim queue consumer runs on the worker tier (worker / dev).
    ...(RUN_PROCESSOR ? [SimulationProcessor] : []),
    // The WS gateway + Redis subscriber run on EVERY HTTP tier — api + realtime + dev —
    // so the socket-holding realtime tier can fan tracking updates out.
    ...(IS_HTTP_TIER ? [TrackingGateway, TrackingSubscriber] : []),
    // The MQTT ingest subscribers (telemetry + command-ack) run on the INGEST tier —
    // api + dev — NOT the realtime tier (which fans OUT, it doesn't ingest). MQTT5 shared
    // subscriptions deliver each frame to exactly ONE replica.
    ...(IS_INGEST_TIER
      ? [MqttTelemetrySubscriber, MqttCommandAckSubscriber]
      : []),
  ],
  exports: [
    DeliveriesService,
    TrackingService,
    TrackingHotStore,
    TrackingPublisher,
    DroneCommandService,
  ],
})
export class DeliveriesModule {}
