import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DeliveryStatus } from '@prisma/client';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ProofService } from '../proof/proof.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import {
  POSITION_JOB,
  PositionJobData,
  SIM_QUEUE,
  STAGES,
  STAGE_JOB,
  StageJobData,
  dronePositionForStage,
} from './simulation.constants';

/**
 * Worker that advances delivery simulations. Runs in-process today; because all
 * state lives in Redis + Postgres, it can be split into a standalone worker
 * deployment unchanged (see ARCHITECTURE.md §1).
 */
@Processor(SIM_QUEUE)
export class SimulationProcessor extends WorkerHost {
  private readonly logger = new Logger(SimulationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
    private readonly trackingGateway: TrackingGateway,
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

    // Guard: skip if the delivery was canceled or deleted.
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.status === DeliveryStatus.CANCELED) return;

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: stage.status },
    });

    const dronePos = dronePositionForStage(stage.status, coords);

    await this.trackingService.updateTracking(deliveryId, {
      droneLat: dronePos?.lat,
      droneLng: dronePos?.lng,
      droneStatus: stage.droneStatus,
      eta:
        stage.status === DeliveryStatus.DELIVERED
          ? undefined
          : new Date(Date.now() + 60_000),
    });

    await this.notificationsService.create(userId, stage.title, stage.body, {
      deliveryId,
      status: stage.status,
    });

    this.trackingGateway.broadcastTrackingUpdate(deliveryId, {
      deliveryId,
      status: stage.status,
      droneStatus: stage.droneStatus,
      droneLat: dronePos?.lat,
      droneLng: dronePos?.lng,
    });

    this.logger.log(`Delivery ${deliveryId} → ${stage.status}`);

    if (stage.status === DeliveryStatus.DELIVERED) {
      try {
        await this.proofService.createAutoProof(deliveryId, {
          lat: coords.toLat,
          lng: coords.toLng,
          recipientName: delivery.receiver,
        });
      } catch (error) {
        this.logger.warn(
          `Proof creation failed [${deliveryId}]: ${(error as Error).message}`,
        );
      }
    }
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
    this.trackingGateway.broadcastTrackingUpdate(deliveryId, {
      deliveryId,
      droneLat: lat,
      droneLng: lng,
    });
  }
}
