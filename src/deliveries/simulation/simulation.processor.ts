import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { DeliveryFailureReason, DeliveryStatus } from '@prisma/client';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { withJobSpan } from '../../common/monitoring/tracing';
import { I18nService } from '../../i18n/i18n.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { POSITION_FROZEN_STATUSES } from '../delivery-exceptions';
import { DeliveriesService } from '../deliveries.service';
import {
  DispatchService,
  isPermanentDispatchRefusal,
} from '../../dispatch/dispatch.service';
import { MetricsService } from '../../metrics/metrics.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
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
import { classifyPreflight, holdExhausted } from './preflight';
import { PREFLIGHT_MAX_ATTEMPTS } from './preflight.constants';

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
    private readonly serviceability: ServiceabilityService,
    private readonly dispatchService: DispatchService,
    private readonly deliveries: DeliveriesService,
    private readonly metrics: MetricsService,
    private readonly i18n: I18nService,
  ) {
    super();
  }

  /** The delivery owner's language (worker has no request context). Falls back to
   * the default locale if the user/row is missing — translate() handles it. */
  private async resolveLocale(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return user?.locale ?? null;
  }

  async process(job: Job): Promise<void> {
    // Continue the enqueueing request's trace (carrier injected at enqueue) under a
    // CONSUMER span, so this job's DB/Redis spans share the create request's traceId.
    // No-op wrapper (runs the dispatch directly) when tracing is disabled.
    const carrier = (job.data as { _carrier?: unknown })?._carrier;
    await withJobSpan(job.name, carrier, async () => {
      if (job.name === STAGE_JOB) {
        await this.handleStage(job.data as StageJobData);
      } else if (job.name === POSITION_JOB) {
        await this.handlePosition(job.data as PositionJobData);
      } else if (job.name === KICKOFF_JOB) {
        await this.handleKickoff(job.data as KickoffJobData);
      }
    });
  }

  /**
   * Fires at a scheduled delivery's pickup window: runs the pre-flight check,
   * acquires an aircraft, enqueues the lifecycle and flips SCHEDULED → PENDING.
   *
   * This is the moment immediately before rotor spin-up, and until now nothing
   * happened here except an unconditional launch. Serviceability was evaluated in
   * the quote and in `create()` and never again, so a delivery booked 60 days out
   * was weather-checked at BOOKING and then launched into whatever was actually
   * happening two months later. A forecast is not a safety control.
   *
   * Ordering matters, and there are now two constraints on it:
   *
   *   ENQUEUE BEFORE THE CAS. startSimulation is idempotent (deterministic jobIds
   *   dedup), so a transient enqueue failure can retry. Flipping first would
   *   consume the SCHEDULED→PENDING transition, so the retry's CAS would no-op and
   *   the lifecycle jobs would never be enqueued — stranding the delivery forever.
   *
   *   CLAIM BEFORE THE CAS, RELEASE IF THE CAS LOSES. The aircraft claim commits on
   *   a separate, non-partitioned row, so it does not roll back with anything. If
   *   the delivery was canceled during the pre-flight, the CAS matches nothing and
   *   the airframe has to be handed back explicitly or it is held forever.
   *
   * The leading status read skips a canceled / already-kicked-off delivery; the
   * final CAS is the authoritative single-winner guard.
   */
  private async handleKickoff(data: KickoffJobData): Promise<void> {
    const { deliveryId, deliveryCreatedAt, userId, coords } = data;
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: {
        status: true,
        createdAt: true,
        fromLat: true,
        fromLng: true,
        toLat: true,
        toLng: true,
        packageWeight: true,
      },
    });
    if (!delivery || delivery.status !== DeliveryStatus.SCHEDULED) return;

    const cleared = await this.preflight(data, delivery);
    if (!cleared) return;

    // Acquire an aircraft NOW rather than at booking. A scheduled delivery cannot
    // hold an airframe out of service for weeks, so `create()` deliberately claims
    // nothing for one — this is where that deferral is paid off.
    //
    // Which also makes this the FIRST time the fleet is consulted about a delivery
    // the customer has already paid for. An escaping refusal fails the job, and
    // SCHEDULED is reachable by neither the watchdog nor FAILABLE_STATUSES, so the
    // delivery would sit there indefinitely looking to its customer exactly like
    // one about to happen — the precise outcome the pre-flight ABORT above exists
    // to prevent. A refusal gets the same treatment as bad weather.
    let dispatched: Awaited<ReturnType<DispatchService['dispatch']>>;
    try {
      dispatched = await this.dispatchService.dispatch({
        deliveryId,
        payloadKg: delivery.packageWeight,
        route: {
          fromLat: delivery.fromLat ?? undefined,
          fromLng: delivery.fromLng ?? undefined,
          toLat: delivery.toLat ?? undefined,
          toLng: delivery.toLng ?? undefined,
        },
        // Not scheduled ANY MORE — its window is now, which is the whole point.
        isScheduled: false,
      });
    } catch (error) {
      await this.handleDispatchRefusal(data, error);
      return;
    }

    // A live delivery is driven by real telemetry and enqueues no simulation jobs;
    // that is what guarantees a sim and a live producer can never both drive one row.
    if (!dispatched.droneId) {
      await this.simulationService.startSimulation(
        deliveryId,
        this.resolveCreatedAt(deliveryCreatedAt, delivery.createdAt),
        userId,
        coords,
      );
    }

    let count: number;
    try {
      ({ count } = await this.prisma.delivery.updateMany({
        where: { id: deliveryId, status: DeliveryStatus.SCHEDULED },
        data: {
          status: DeliveryStatus.PENDING,
          // Co-committed with the transition, so a delivery is never PENDING while
          // still claiming to be SIMULATED with a live airframe bound to it.
          ...(dispatched.droneId
            ? {
                trackingSource: dispatched.trackingSource,
                assignedDroneId: dispatched.droneId,
              }
            : {}),
        },
      }));
    } catch (error) {
      // A THROW here is not the same as a lost race, and it used to fall straight
      // past the release below: the pool timeout this retries for would leave the
      // airframe claimed against a delivery still sitting in SCHEDULED, which
      // nothing releases.
      //
      // But a rejected promise is NOT proof the statement did not commit — the
      // same post-commit reject create()'s reservation catch is written around. If
      // the transition DID land, the delivery is PENDING and bound to this
      // aircraft, and the retry short-circuits on the leading status read, so
      // nothing would ever re-claim it. Releasing blind would hand a drone that is
      // about to fly back to the dispatchable pool — turning a recoverable leak
      // into the double-booking this whole module exists to prevent.
      //
      // So: release only on PROOF the transition did not happen. Anything else,
      // including a failed re-read, keeps the claim — a leak is recoverable (the
      // claim is re-entrant, so the retry picks the same airframe back up), and a
      // double-booked aircraft is not.
      if (dispatched.droneId) {
        const current = await this.prisma.delivery
          .findFirst({ where: { id: deliveryId }, select: { status: true } })
          .catch(() => null);
        if (current?.status === DeliveryStatus.SCHEDULED) {
          await this.dispatchService.release(deliveryId, 'RETURN_TO_FLEET');
        } else {
          this.logger.warn(
            `Delivery ${deliveryId} kickoff write failed ambiguously ` +
              `(status now ${current?.status ?? 'unknown'}) — keeping the claim on ` +
              `${dispatched.droneId} rather than risk re-pooling a live airframe`,
          );
        }
      }
      throw error;
    }

    if (count === 0) {
      // Lost the race — canceled, or another replica kicked it off. Give the
      // aircraft back; nothing else will, because every later release is keyed on
      // a delivery that is no longer ours to release.
      if (dispatched.droneId) {
        await this.dispatchService.release(deliveryId, 'RETURN_TO_FLEET');
      }
      return;
    }

    this.logger.log(
      `Delivery ${deliveryId} kicked off (SCHEDULED → PENDING)` +
        (dispatched.droneId ? ` on drone ${dispatched.droneId}` : ''),
    );
  }

  /**
   * The fleet refused the launch. Same two outcomes as the pre-flight check, for
   * the same reason: hold what waiting can fix, give up on what it cannot.
   *
   * A saturated fleet is transient — an airframe lands every few minutes — so it
   * shares the pre-flight's hold budget rather than getting its own. Sharing is
   * deliberate: the budget exists to bound how long a customer is left watching a
   * delivery that has not started, and that bound must not double because the
   * reason for holding changed halfway through.
   *
   * `no_capacity` is permanent — nothing in the fleet can lift this payload, and
   * an hour of holding ends in the same refusal. `create()` cannot catch this one
   * for a scheduled delivery because it deliberately never asks the engine.
   */
  private async handleDispatchRefusal(
    data: KickoffJobData,
    error: unknown,
  ): Promise<void> {
    const { deliveryId } = data;
    const attempt = data.preflightAttempt ?? 0;
    const permanent = isPermanentDispatchRefusal(error);
    const code = permanent ? 'DISPATCH_NO_CAPACITY' : 'DISPATCH_UNAVAILABLE';

    if (!permanent && !holdExhausted(attempt, PREFLIGHT_MAX_ATTEMPTS)) {
      this.logger.warn(
        `Delivery ${deliveryId} held on the ground (${code}), ` +
          `attempt ${attempt + 1}/${PREFLIGHT_MAX_ATTEMPTS}`,
      );
      await this.simulationService.deferKickoff(data, attempt + 1);
      this.metrics.preflightHoldsTotal.inc({ code });
      return;
    }

    this.logger.warn(
      `Delivery ${deliveryId} aborted at pre-flight (${code}): ` +
        `${(error as Error).message}`,
    );
    this.metrics.preflightAbortsTotal.inc({ code });
    // Refunded, like every other pre-flight abort: the customer booked a delivery
    // we accepted and then could not fly. Scoped to SCHEDULED for the same reason
    // the pre-flight abort is — nothing here may fail a delivery that has launched.
    await this.deliveries.failExceptional(
      deliveryId,
      DeliveryFailureReason.OTHER,
      [DeliveryStatus.SCHEDULED],
    );
  }

  /**
   * The check immediately before launch. Returns true to proceed.
   *
   * Three outcomes, and the one that did not exist before is HOLD: conditions that
   * will pass are waited out on the ground rather than flown into, and conditions
   * that will not are given up on rather than held indefinitely. A delivery held
   * forever sits in SCHEDULED looking to its customer exactly like one that is
   * about to happen.
   *
   * Fail-open on an unresolved route only — a delivery with no coordinates cannot
   * be geometrically checked, and it also cannot be dispatched (DispatchService
   * rejects it), so there is nothing to gain by failing it twice.
   */
  private async preflight(
    data: KickoffJobData,
    delivery: {
      fromLat: number | null;
      fromLng: number | null;
      toLat: number | null;
      toLng: number | null;
    },
  ): Promise<boolean> {
    const { deliveryId } = data;
    const { fromLat, fromLng, toLat, toLng } = delivery;
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
      return true;
    }

    const result = await this.serviceability.checkServiceability(
      fromLat,
      fromLng,
      toLat,
      toLng,
    );
    const verdict = classifyPreflight(result);
    if (verdict.action === 'LAUNCH') return true;

    const attempt = data.preflightAttempt ?? 0;

    if (
      verdict.action === 'HOLD' &&
      !holdExhausted(attempt, PREFLIGHT_MAX_ATTEMPTS)
    ) {
      this.logger.warn(
        `Delivery ${deliveryId} held on the ground (${verdict.code}), ` +
          `attempt ${attempt + 1}/${PREFLIGHT_MAX_ATTEMPTS}`,
      );
      await this.simulationService.deferKickoff(data, attempt + 1);
      this.metrics.preflightHoldsTotal.inc({ code: verdict.code ?? 'UNKNOWN' });
      return false;
    }

    // Either a hard block, or we have run out of patience with a transient one.
    // Both end the delivery — with a refund, because nothing about this is the
    // customer's doing: they booked a delivery we accepted and then could not fly.
    this.logger.warn(
      `Delivery ${deliveryId} aborted at pre-flight (${verdict.code ?? 'unknown'})`,
    );
    this.metrics.preflightAbortsTotal.inc({ code: verdict.code ?? 'UNKNOWN' });
    await this.deliveries.failExceptional(
      deliveryId,
      verdict.reason ?? DeliveryFailureReason.OTHER,
      // FAILABLE_STATUSES covers the in-flight states and deliberately excludes
      // SCHEDULED — nothing else may fail a delivery that has not launched. Pass
      // the narrow set explicitly, exactly as the watchdog passes its own.
      [DeliveryStatus.SCHEDULED],
    );
    return false;
  }

  private async handleStage({
    deliveryId,
    deliveryCreatedAt,
    userId,
    coords,
    stageIndex,
  }: StageJobData): Promise<void> {
    const stage = STAGES[stageIndex];
    if (!stage) return;

    const delivery = await this.prisma.delivery.findFirst({
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

    // Localize all user-facing strings to the delivery OWNER's language (worker
    // has no request context — resolve User.locale by userId; a cheap indexed PK
    // read). This sits in the post-CAS / pre-side-effect window, so a transient DB
    // error here must NOT escape (the CAS already committed; a thrown error would
    // fail the job and the retry's CAS no-ops, stranding the side-effects). Swallow
    // to null → translate() falls back to English. translate() itself never throws.
    const locale = await this.resolveLocale(userId).catch((error) => {
      this.logger.warn(
        `Locale resolve failed for ${userId}, falling back to default: ${(error as Error).message}`,
      );
      return null;
    });
    const base = `notification.stage.${stage.status}`;
    const title = this.i18n.translate(`${base}.title`, locale);
    const body = this.i18n.translate(`${base}.body`, locale);
    const droneStatus = this.i18n.translate(`${base}.droneStatus`, locale);

    // Side effects are best-effort: a transient failure must not fail the
    // already-applied transition (which would skip on retry via the CAS above).
    await this.safe(() =>
      this.trackingService.updateTracking(
        deliveryId,
        this.resolveCreatedAt(deliveryCreatedAt, delivery.createdAt),
        {
          droneLat: dronePos?.lat,
          droneLng: dronePos?.lng,
          droneStatus,
          eta:
            stage.status === DeliveryStatus.AWAITING_HANDOFF
              ? undefined
              : new Date(Date.now() + 60_000),
        },
      ),
    );

    await this.safe(() =>
      this.notificationsService.create(userId, title, body, {
        deliveryId,
        status: stage.status,
      }),
    );

    await this.trackingPublisher.publishUpdate({
      deliveryId,
      status: stage.status,
      droneStatus,
      droneLat: dronePos?.lat,
      droneLng: dronePos?.lng,
    });

    this.logger.log(`Delivery ${deliveryId} → ${stage.status}`);
    // Proof of delivery is recorded when the recipient confirms the handoff OTP
    // (DeliveriesService.confirmHandoff), not here — the sim stops at AWAITING_HANDOFF.
  }

  /**
   * The parent delivery's createdAt (the partition key) used to write composite-FK
   * children. Normally it rides on the job payload, but a job enqueued BEFORE the
   * delivery-graph partitioning deploy has no `deliveryCreatedAt` → `new Date(undefined)`
   * is an Invalid Date. Left unguarded that throws a RangeError in startSimulation (which
   * stranded a kickoff's delivery in SCHEDULED) and an FK violation in updateTracking. We
   * already read the delivery row in each handler, so fall back to its real createdAt when
   * the payload value is missing or unparseable. (Steady-state jobs always carry it.)
   */
  private resolveCreatedAt(
    payloadIso: string | undefined,
    fallback: Date,
  ): Date {
    if (payloadIso) {
      const d = new Date(payloadIso);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return fallback;
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
    deliveryCreatedAt,
    lat,
    lng,
  }: PositionJobData): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { status: true, createdAt: true },
    });
    if (!delivery || POSITION_FROZEN_STATUSES.includes(delivery.status)) {
      return;
    }

    await this.trackingService.updateTracking(
      deliveryId,
      this.resolveCreatedAt(deliveryCreatedAt, delivery.createdAt),
      {
        droneLat: lat,
        droneLng: lng,
      },
    );
    await this.trackingPublisher.publishUpdate({
      deliveryId,
      droneLat: lat,
      droneLng: lng,
    });
  }
}
