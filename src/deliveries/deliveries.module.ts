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
import { DroneAuthGuard } from './telemetry/drone-auth.guard';
import { MqttTelemetrySubscriber } from './telemetry/mqtt-telemetry.subscriber';
import { MqttCommandAckSubscriber } from './commands/mqtt-command-ack.subscriber';
import { TelemetryController } from './telemetry/telemetry.controller';
import { TelemetryService } from './telemetry/telemetry.service';
import { CommandController } from './commands/command.controller';
import { DroneCommandService } from './commands/drone-command.service';

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
    // The worker publishes tracking updates to Redis; runs everywhere.
    TrackingPublisher,
    // Live drone telemetry ingest core (transport-agnostic) + its gateway auth.
    TelemetryService,
    DroneAuthGuard,
    // Backend → drone command outbox (issue/poll/ack). Provided on every tier so
    // AdminService (api) and the controller can reuse it.
    DroneCommandService,
    // The queue consumer (worker / dev), and the WS gateway + subscriber (api / dev).
    ...(RUN_PROCESSOR ? [SimulationProcessor] : []),
    // The WS gateway + Redis subscriber + the MQTT ingest subscribers (telemetry + command
    // ack) run wherever HTTP is served — NOT the worker. With MQTT5 shared subscriptions
    // (default) the broker still delivers each frame to exactly ONE api replica.
    ...(IS_API
      ? [
          TrackingGateway,
          TrackingSubscriber,
          MqttTelemetrySubscriber,
          MqttCommandAckSubscriber,
        ]
      : []),
  ],
  exports: [
    DeliveriesService,
    TrackingService,
    TrackingPublisher,
    DroneCommandService,
  ],
})
export class DeliveriesModule {}
