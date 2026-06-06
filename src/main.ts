// Load .env into process.env before the module graph is imported, so flags read
// at import time (e.g. PROCESS_ROLE in deliveries.module) honor .env.
import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body so Stripe webhook
  // signatures can be verified (req.rawBody).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  // Global prefix: api/v1
  const prefix = config.get<string>('apiPrefix', 'api/v1');
  app.setGlobalPrefix(prefix);

  // CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Drain in-process BullMQ workers + close the pg pool on SIGTERM/SIGINT so a
  // rolling deploy finishes active jobs instead of orphaning them.
  app.enableShutdownHooks();

  const port = config.get<number>('port', 3000);
  await app.listen(port);

  console.log(`Drovery API running on http://localhost:${port}/${prefix}`);
}

bootstrap();
