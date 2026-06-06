import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  DeliveryCoords,
  POSITION_JOB,
  POSITION_TICK_COUNT,
  SIM_QUEUE,
  STAGE_JOB,
  STAGES,
  buildPositionTicks,
  resolveCoords,
} from './simulation.constants';

const JOB_OPTS = {
  // Retry transient failures (DB blip, etc.) with backoff. Handlers are
  // idempotent (deterministic jobIds + monotonic CAS), so retries are safe.
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  // Time/count-based retention so a burst doesn't evict failure history.
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 5000 },
};

// Bound the producer enqueue so creating a delivery degrades gracefully (instead
// of hanging) if Redis is unreachable — the BullMQ offline queue retries forever.
const ENQUEUE_TIMEOUT_MS = 2000;

/**
 * Schedules a delivery's lifecycle as durable, delayed BullMQ jobs in Redis
 * (instead of in-process `setTimeout`). This survives restarts and lets any
 * worker instance advance any delivery — the foundation for horizontal scaling.
 */
@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(@InjectQueue(SIM_QUEUE) private readonly queue: Queue) {}

  async startSimulation(
    deliveryId: string,
    userId: string,
    coords?: Partial<DeliveryCoords>,
  ): Promise<void> {
    const c = resolveCoords(coords);

    const stageJobs = STAGES.map((stage, i) => ({
      name: STAGE_JOB,
      data: { deliveryId, userId, coords: c, stageIndex: i },
      opts: { ...JOB_OPTS, delay: stage.delayMs, jobId: `${deliveryId}:stage:${i}` },
    }));

    const positionJobs = buildPositionTicks(c).map((tick, j) => ({
      name: POSITION_JOB,
      data: { deliveryId, lat: tick.lat, lng: tick.lng },
      opts: { ...JOB_OPTS, delay: tick.delay, jobId: `${deliveryId}:pos:${j}` },
    }));

    await this.withTimeout(
      this.queue.addBulk([...stageJobs, ...positionJobs]),
      ENQUEUE_TIMEOUT_MS,
      'enqueue simulation',
    );
    this.logger.log(
      `Queued simulation for ${deliveryId} (${stageJobs.length} stages, ${positionJobs.length} ticks)`,
    );
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms (Redis unreachable?)`)),
        ms,
      );
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  /** Best-effort removal of a delivery's pending jobs (e.g. on cancel). */
  async stopSimulation(deliveryId: string): Promise<void> {
    const ids: string[] = [];
    for (let i = 0; i < STAGES.length; i++) ids.push(`${deliveryId}:stage:${i}`);
    for (let j = 0; j < POSITION_TICK_COUNT; j++) ids.push(`${deliveryId}:pos:${j}`);

    await Promise.all(
      ids.map((id) => this.queue.remove(id).catch(() => undefined)),
    );
    this.logger.log(`Removed pending simulation jobs for ${deliveryId}`);
  }
}
