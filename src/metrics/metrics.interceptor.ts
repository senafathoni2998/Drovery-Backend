import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import { MetricsService } from './metrics.service';

/**
 * Records HTTP duration + count on `res.on('finish')` — NOT via an rxjs `tap`,
 * because AllExceptionsFilter sets the final status code AFTER the handler's
 * stream completes, so a tap would record the wrong status. Running as an
 * interceptor (post-routing) also means `req.route.path` is populated, giving us
 * the route TEMPLATE for the label instead of the high-cardinality raw URL.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const route = req.route?.path
        ? (req.baseUrl || '') + req.route.path
        : 'unmatched';
      // Don't record the Prometheus scrape endpoint itself — it would be a
      // self-referential series that grows with scrape frequency, not real traffic.
      if (route.endsWith('/metrics')) return;
      const labels = {
        method: req.method,
        status: String(res.statusCode),
        route,
      };
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpDuration.observe(labels, seconds);
      this.metrics.httpTotal.inc(labels);
    });

    return next.handle();
  }
}
