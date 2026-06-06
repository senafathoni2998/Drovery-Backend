import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { PricingModule } from './pricing/pricing.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GeoModule } from './geo/geo.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    // Configuration — loads .env and config/configuration.ts
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Redis-backed job queue (durable delivery simulation / worker tier)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          // Required by BullMQ workers so commands don't error during reconnects.
          maxRetriesPerRequest: null,
        },
      }),
    }),

    // Database
    PrismaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    DeliveriesModule,
    PricingModule,
    WorkflowsModule,
    PaymentsModule,
    NotificationsModule,
    GeoModule,
    SupportModule,
  ],
  providers: [
    // Apply JWT auth guard globally — use @Public() to opt out
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
