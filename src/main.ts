// Load .env into process.env before the module graph is imported, so flags read
// at import time (e.g. PROCESS_ROLE in deliveries.module) honor .env.
import 'dotenv/config';
// Initialize Sentry before any app modules load (no-op without SENTRY_DSN).
import { sentryEnabled } from './common/monitoring/sentry';
// Initialize OpenTelemetry tracing BEFORE the module graph (so http/express/pg/
// ioredis are patched at require time). No-op unless TRACING_ENABLED / an OTLP
// endpoint is set (and Sentry is off). MUST stay above the AppModule import.
import { tracingEnabled, shutdownTracing } from './common/monitoring/tracing';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { i18nValidationExceptionFactory } from './common/validation/validation-exception.factory';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { setupSwagger } from './common/swagger';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body so Stripe webhook
  // signatures can be verified (req.rawBody). bufferLogs holds startup logs
  // until the pino logger takes over.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  // Route all Nest logs through pino (structured JSON + request ids).
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  // Use the raw 'ws' adapter for the tracking gateway. Without this, Nest would
  // default to socket.io (also installed), which doesn't speak the {event,data}
  // protocol our ws clients use — they'd connect but never receive frames.
  app.useWebSocketAdapter(new WsAdapter(app));

  // Global prefix: api/v1
  const prefix = config.get<string>('apiPrefix', 'api/v1');
  app.setGlobalPrefix(prefix);

  // CORS — use an allowlist (with credentials) when configured; otherwise a
  // wildcard WITHOUT credentials (browsers reject `*` + credentials).
  const corsOrigins = config.get<string>('corsOrigins');
  app.enableCors(
    corsOrigins
      ? {
          origin: corsOrigins.split(',').map((o) => o.trim()),
          methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
          credentials: true,
        }
      : { origin: '*', methods: 'GET,HEAD,PUT,PATCH,POST,DELETE' },
  );

  // Global pipes. The exceptionFactory turns each validation failure into a stable catalog
  // key (validation.<constraint>) + params; AllExceptionsFilter translates it per request.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: i18nValidationExceptionFactory,
    }),
  );

  // AllExceptionsFilter is registered as an APP_FILTER in AppModule (DI — it injects
  // I18nService). Do NOT also register it here, or it would run twice.
  app.useGlobalInterceptors(new TransformInterceptor());

  // Interactive OpenAPI docs at /{prefix}/docs (unless SWAGGER_ENABLED=false).
  const docsPath = setupSwagger(app, prefix);

  // Drain in-process BullMQ workers + close the pg pool on SIGTERM/SIGINT so a
  // rolling deploy finishes active jobs instead of orphaning them.
  app.enableShutdownHooks();

  // Flush buffered trace spans on shutdown (no-op when tracing is disabled).
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      void shutdownTracing();
    });
  }

  const port = config.get<number>('port', 3000);
  await app.listen(port);

  console.log(`Drovery API running on http://localhost:${port}/${prefix}`);
  if (docsPath) {
    console.log(`API docs: http://localhost:${port}/${docsPath}`);
  }
  console.log(
    `Sentry error tracking: ${sentryEnabled ? 'enabled' : 'disabled (no SENTRY_DSN)'}`,
  );
  console.log(
    `Distributed tracing: ${tracingEnabled ? 'enabled (OpenTelemetry)' : 'disabled'}`,
  );
}

bootstrap();
