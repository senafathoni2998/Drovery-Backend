import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard variant that can fully bypass rate limiting for load testing.
 *
 * The throttler is Redis-backed and SHARED across replicas, so a single k6 IP
 * saturates the per-IP limit in seconds and 2 replicas would show the SAME
 * throughput as 1 — masking horizontal scaling. Setting LOADTEST_BYPASS_THROTTLE
 * on the load-test deployment removes that ceiling so k6 measures real app/DB/
 * worker throughput.
 *
 * Hard-disabled in production two ways: (1) here, the bypass requires
 * NODE_ENV !== 'production'; (2) src/config/validation.ts refuses to boot if the
 * flag is set under NODE_ENV=production. The flag can never weaken a real deploy.
 */
@Injectable()
export class LoadTestThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (
      process.env.LOADTEST_BYPASS_THROTTLE === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      return true;
    }
    return super.shouldSkip(context);
  }
}
