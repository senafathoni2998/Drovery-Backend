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

const JOB_OPTS = { removeOnComplete: true, removeOnFail: 50 };

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

    await this.queue.addBulk([...stageJobs, ...positionJobs]);
    this.logger.log(
      `Queued simulation for ${deliveryId} (${stageJobs.length} stages, ${positionJobs.length} ticks)`,
    );
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
