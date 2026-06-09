import 'dotenv/config';
// Initialize Sentry before any app modules load (no-op without SENTRY_DSN).
import './common/monitoring/sentry';

import { createServer } from 'http';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { MetricsService } from './metrics/metrics.service';

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

  // The worker has no Express server, but KEDA scales it on queue depth — so it
  // serves the same metrics registry over a tiny raw HTTP server at /metrics
  // (root path; no api/v1 prefix here). Only the queue gauge + default metrics
  // are meaningful on the worker (it serves no HTTP traffic of its own).
  const config = app.get(ConfigService);
  const metrics = app.get(MetricsService);
  const metricsPort = config.get<number>('metrics.port', 9091);
  const enabled = config.get<boolean>('metrics.enabled') !== false;

  const server = createServer((req, res) => {
    if (enabled && req.method === 'GET' && req.url === '/metrics') {
      metrics
        .metrics()
        .then((body) => {
          res.setHeader('Content-Type', metrics.contentType);
          res.end(body);
        })
        .catch(() => {
          res.statusCode = 500;
          res.end();
        });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(metricsPort, () =>
    logger.log(`Worker metrics on :${metricsPort}/metrics`),
  );
  // Close the metrics server on shutdown alongside Nest's hooks.
  const closeServer = () => server.close();
  process.on('SIGTERM', closeServer);
  process.on('SIGINT', closeServer);

  logger.log('Drovery simulation worker running — processing BullMQ jobs');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker failed to start:', err);
  process.exit(1);
});
