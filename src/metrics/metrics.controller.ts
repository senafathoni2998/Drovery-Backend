import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * GET /api/v1/metrics — Prometheus scrape target.
 *
 * @Public + @SkipThrottle: scrapers carry no JWT and poll frequently. This is
 * unauthenticated by design, so in production it should be network-restricted
 * (cluster-internal Service / NetworkPolicy) and can be killed via
 * METRICS_ENABLED=false. Uses @Res() (no passthrough) to emit the raw 0.0.4
 * exposition text, bypassing the global TransformInterceptor's {success,data}
 * envelope (which Prometheus could not parse).
 */
@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    if (this.config.get<boolean>('metrics.enabled') === false) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.metrics());
  }
}
