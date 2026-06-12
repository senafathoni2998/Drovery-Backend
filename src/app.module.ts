import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoadTestThrottlerGuard } from './common/guards/loadtest-throttle.guard';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import { randomUUID } from 'crypto';
import configuration from './config/configuration';
import { validate } from './config/validation';
import { buildRedisOptions } from './config/redis';
import { redactTokenInUrl } from './common/redact';
import { CacheModule } from './cache/cache.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
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
    // Redis-backed storage so the limit is shared across ALL API instances; an
    // in-memory store would multiply the effective limit by the replica count.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('ThrottlerRedis');
        const client = new Redis({
          ...buildRedisOptions(config),
          // Throttle checks must fail fast rather than hang on a Redis blip.
          maxRetriesPerRequest: 2,
        });
        client.on('error', (err) =>
          logger.warn(`throttler redis error: ${err.message}`),
        );
        return {
          throttlers: [{ ttl: 60_000, limit: 100 }],
          storage: new ThrottlerStorageRedisService(client),
        };
      },
    }),

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
        // Strip ?token= from logged URLs (the WS handshake puts the JWT there).
        serializers: {
          req: stdSerializers.wrapRequestSerializer((req) => {
            req.url = redactTokenInUrl(req.url);
            return req;
          }),
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),

    // Redis-backed job queue (durable delivery simulation / worker tier).
    // BullMQ creates its own connection from these options (separate from the
    // cache + throttler clients). maxRetriesPerRequest: null is required so
    // queue commands don't error during reconnects.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          ...buildRedisOptions(config),
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
    MetricsModule,
  ],
  providers: [
    // Rate-limit first (before auth) — global per-IP throttle. The LoadTest
    // variant can bypass the limit for load testing (non-prod only); it behaves
    // exactly like ThrottlerGuard unless LOADTEST_BYPASS_THROTTLE is set.
    {
      provide: APP_GUARD,
      useClass: LoadTestThrottlerGuard,
    },
    // Apply JWT auth guard globally — use @Public() to opt out
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
