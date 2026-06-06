import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import configuration from './config/configuration';
import { validate } from './config/validation';
import { CacheModule } from './cache/cache.module';
import { HealthModule } from './health/health.module';
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
    // Configuration — loads .env and config/configuration.ts (validates env;
    // fails boot on weak JWT secrets in production).
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),

    // Rate limiting — 100 req / 60s per IP by default (tighter on auth routes).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // Structured (pino) logging with per-request correlation ids.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id =
            (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        // Never log secrets.
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
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

    // Redis-backed cache (geocoding, etc.)
    CacheModule,

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
    HealthModule,
  ],
  providers: [
    // Rate-limit first (before auth) — global per-IP throttle.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Apply JWT auth guard globally — use @Public() to opt out
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
