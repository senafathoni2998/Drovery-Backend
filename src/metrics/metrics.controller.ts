import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { PublicApi } from '../common/decorators/public-api.decorator';
import { MetricsService } from './metrics.service';

/**
 * GET /api/v1/metrics — Prometheus scrape target.
 *
 * @Public + @SkipThrottle: scrapers carry no JWT and poll frequently. This is
 * unauthenticated by design, so in production it should be network-restricted
 * (cluster-internal Service / NetworkPolicy) and can be killed via
 * METRICS_ENABLED=false. Uses @Res() WITHOUT passthrough to emit the raw 0.0.4
 * exposition text — this commits the response directly, bypassing ALL
 * response-phase interceptors (incl. the global TransformInterceptor's
 * {success,data} envelope, which Prometheus could not parse). The pre-handler
 * MetricsInterceptor still runs but skips this route.
 */
@PublicApi()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    // Match the worker's gate (worker.ts): enabled unless explicitly false.
    const enabled = this.config.get<boolean>('metrics.enabled') !== false;
    if (!enabled) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.metrics());
  }
}
