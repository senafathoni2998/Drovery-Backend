import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import { SIM_QUEUE } from '../deliveries/simulation/simulation.constants';

/**
 * Owns a single Prometheus registry and the app's metrics. Exposed at
 * GET /api/v1/metrics (API) and :METRICS_PORT/metrics (worker).
 *
 * The queue-depth gauge is collected ON SCRAPE (not on a timer), so it never
 * drifts and costs nothing while idle. getJobCounts() is queue-global, so every
 * replica exports the SAME value — the KEDA worker autoscaler therefore queries
 * with max(), not sum(), to avoid multiplying the backlog by the replica count.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<string>;
  readonly httpTotal: Counter<string>;

  constructor(@InjectQueue(SIM_QUEUE) private readonly queue: Queue) {
    collectDefaultMetrics({ register: this.registry, prefix: 'drovery_' });

    this.httpDuration = new Histogram({
      name: 'drovery_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      // Labelled by route TEMPLATE (e.g. /api/v1/deliveries/:id), never the raw
      // URL — labelling raw paths is an unbounded-cardinality trap.
      labelNames: ['method', 'status', 'route'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.httpTotal = new Counter({
      name: 'drovery_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'status', 'route'],
      registers: [this.registry],
    });

    const queueRef = this.queue;
    new Gauge({
      name: 'drovery_queue_jobs',
      help: 'BullMQ job counts by state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      async collect() {
        const counts = await queueRef.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'completed',
          'failed',
        );
        for (const [state, value] of Object.entries(counts)) {
          this.set({ queue: SIM_QUEUE, state }, value);
        }
      },
    });
  }

  /** Prometheus exposition text (0.0.4). */
  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
