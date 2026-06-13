import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { DeliveryStatus } from '@prisma/client';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingPublisher } from '../tracking/tracking.publisher';
import {
  KICKOFF_JOB,
  KickoffJobData,
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
import { SimulationService } from './simulation.service';

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
    private readonly simulationService: SimulationService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === STAGE_JOB) {
      await this.handleStage(job.data as StageJobData);
    } else if (job.name === POSITION_JOB) {
      await this.handlePosition(job.data as PositionJobData);
    } else if (job.name === KICKOFF_JOB) {
      await this.handleKickoff(job.data as KickoffJobData);
    }
  }

  /**
   * Fires at a scheduled delivery's pickup window: enqueues the normal lifecycle
   * and flips SCHEDULED → PENDING.
   *
   * Ordering matters: we ENQUEUE FIRST, then flip the status. startSimulation is
   * idempotent (deterministic jobIds dedup), so if the enqueue fails transiently
   * the job can retry and re-enqueue. Flipping first would consume the
   * SCHEDULED→PENDING transition, so a retry's CAS would no-op and the lifecycle
   * jobs would never be enqueued — stranding the delivery in PENDING forever.
   *
   * The leading status read skips a canceled / already-kicked-off delivery (so we
   * don't enqueue jobs for it); the final CAS is the authoritative single-winner
   * guard (a cancel that races in still leaves the delivery CANCELED, and the
   * stage jobs are themselves monotonic-CAS-guarded, so they no-op).
   */
  private async handleKickoff({
    deliveryId,
    userId,
    coords,
  }: KickoffJobData): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (!delivery || delivery.status !== DeliveryStatus.SCHEDULED) return;

    await this.simulationService.startSimulation(deliveryId, userId, coords);

    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.SCHEDULED },
      data: { status: DeliveryStatus.PENDING },
    });
    if (count > 0) {
      this.logger.log(`Delivery ${deliveryId} kicked off (SCHEDULED → PENDING)`);
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
          stage.status === DeliveryStatus.AWAITING_HANDOFF
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
    // Proof of delivery is recorded when the recipient confirms the handoff OTP
    // (DeliveriesService.confirmHandoff), not here — the sim stops at AWAITING_HANDOFF.
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
      delivery.status === DeliveryStatus.AWAITING_HANDOFF ||
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
