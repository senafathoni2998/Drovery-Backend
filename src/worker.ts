import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * Standalone worker process. Boots the full module graph as a Nest application
 * context (no HTTP server) so the BullMQ `SimulationProcessor` drains the
 * `delivery-simulation` queue. Run independently of the API:
 *
 *   npm run worker            # dev
 *   npm run worker:prod       # built
 *
 * Scale workers and API instances separately. API instances that should NOT
 * also process jobs run with PROCESS_ROLE=api.
 */
async function bootstrap() {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  // Close BullMQ workers / Prisma cleanly on SIGTERM/SIGINT (finishes active jobs).
  app.enableShutdownHooks();

  logger.log('Drovery simulation worker running — processing BullMQ jobs');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker failed to start:', err);
  process.exit(1);
});
