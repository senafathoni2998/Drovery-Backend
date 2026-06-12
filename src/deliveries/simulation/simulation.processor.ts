import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { DeliveryStatus } from '@prisma/client';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ProofService } from '../proof/proof.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingPublisher } from '../tracking/tracking.publisher';
import {
  POSITION_JOB,
  PositionJobData,
  SIM_QUEUE,
  SIM_WORKER_CONCURRENCY,
  STAGES,
  STAGE_JOB,
  StageJobData,
  dronePositionForStage,
  statusesBefore,
} from './simulation.constants';

/**
 * Worker that advances delivery simulations. Runs in-process today; because all
 * state lives in Redis + Postgres, it can be split into a standalone worker
 * deployment unchanged (see ARCHITECTURE.md §1).
 */
@Processor(SIM_QUEUE, { concurrency: SIM_WORKER_CONCURRENCY })
export class SimulationProcessor extends WorkerHost {
  private readonly logger = new Logger(SimulationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
    private readonly trackingPublisher: TrackingPublisher,
    private readonly notificationsService: NotificationsService,
    private readonly proofService: ProofService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === STAGE_JOB) {
      await this.handleStage(job.data as StageJobData);
    } else if (job.name === POSITION_JOB) {
      await this.handlePosition(job.data as PositionJobData);
    }
  }

  private async handleStage({
    deliveryId,
    userId,
    coords,
    stageIndex,
  }: StageJobData): Promise<void> {
    const stage = STAGES[stageIndex];
    if (!stage) return;

    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery) return;

    // Atomic, monotonic, forward-only transition: only advance from a strictly
    // earlier status. This is a compare-and-set at the DB, so it (a) skips a
    // delivery canceled/delivered/already-advanced concurrently — closing the
    // cancel/resurrection race — and (b) makes a re-run (retry / stalled job
    // re-delivery) a no-op instead of a duplicate transition or regression.
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: { in: statusesBefore(stage.status) } },
      data: { status: stage.status },
    });
    if (count === 0) return;

    const dronePos = dronePositionForStage(stage.status, coords);

    // Side effects are best-effort: a transient failure must not fail the
    // already-applied transition (which would skip on retry via the CAS above).
    await this.safe(() =>
      this.trackingService.updateTracking(deliveryId, {
        droneLat: dronePos?.lat,
        droneLng: dronePos?.lng,
        droneStatus: stage.droneStatus,
        eta:
          stage.status === DeliveryStatus.DELIVERED
            ? undefined
            : new Date(Date.now() + 60_000),
      }),
    );

    await this.safe(() =>
      this.notificationsService.create(userId, stage.title, stage.body, {
        deliveryId,
        status: stage.status,
      }),
    );

    await this.trackingPublisher.publishUpdate({
      deliveryId,
      status: stage.status,
      droneStatus: stage.droneStatus,
      droneLat: dronePos?.lat,
      droneLng: dronePos?.lng,
    });

    this.logger.log(`Delivery ${deliveryId} → ${stage.status}`);

    if (stage.status === DeliveryStatus.DELIVERED) {
      await this.safe(() =>
        this.proofService.createAutoProof(deliveryId, {
          lat: coords.toLat,
          lng: coords.toLng,
          recipientName: delivery.receiver,
        }),
      );
    }
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`Stage side-effect failed: ${(error as Error).message}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `Job ${job?.id} (${job?.name}) failed after ${job?.attemptsMade} attempt(s): ${err?.message}`,
    );
  }

  private async handlePosition({
    deliveryId,
    lat,
    lng,
  }: PositionJobData): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (
      !delivery ||
      delivery.status === DeliveryStatus.CANCELED ||
      delivery.status === DeliveryStatus.DELIVERED
    ) {
      return;
    }

    await this.trackingService.updateTracking(deliveryId, {
      droneLat: lat,
      droneLng: lng,
    });
    await this.trackingPublisher.publishUpdate({
      deliveryId,
      droneLat: lat,
      droneLng: lng,
    });
  }
}
