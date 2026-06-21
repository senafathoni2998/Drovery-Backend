import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { PublicApi } from '../common/decorators/public-api.decorator';
import { LiveResponseDto, ReadyResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

// Public + un-throttled so orchestrator probes (k8s/load balancers) aren't
// blocked by auth or rate limits.
@PublicApi()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: the process is up and serving. */
  @Get()
  @ApiOkResponse({ type: LiveResponseDto })
  live() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: critical dependencies (DB, Redis) are reachable. 503 if not. */
  @Get('ready')
  @ApiOkResponse({ type: ReadyResponseDto })
  async ready() {
    const checks = await this.healthService.check();
    const ok = Object.values(checks).every(Boolean);

    if (!ok) {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }
}
