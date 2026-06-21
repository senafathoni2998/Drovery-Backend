import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  TrackingSource,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { I18nService } from '../../i18n/i18n.service';
import {
  AppBadRequestException,
  AppForbiddenException,
} from '../../common/exceptions/app-exception';
import { DeliveriesService } from '../deliveries.service';
import { POSITION_FROZEN_STATUSES } from '../delivery-exceptions';
import { statusesBefore } from '../simulation/simulation.constants';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingPublisher } from '../tracking/tracking.publisher';
import {
  DRONE_STATUS_MAX_LEN,
  EXCEPTION_PHASE_TO_STATUS,
  ExceptionPhase,
  HappyPhase,
  LAT_MAX,
  LAT_MIN,
  LNG_MAX,
  LNG_MIN,
  PHASE_TO_STATUS,
  TelemetryMessage,
  isExceptionPhase,
} from './telemetry.constants';

export interface IngestResult {
  applied: boolean;
  status?: DeliveryStatus;
}

/**
 * Transport-agnostic core for live drone telemetry. The HTTP endpoint and the
 * (deferred) MQTT subscriber both authenticate/parse and then call ingest(), so
 * a real drone and the simulation are interchangeable producers of the SAME
 * tracking contract.
 *
 * It REUSES the existing primitives — the monotonic forward-only status CAS
 * (statusesBefore), TrackingService.updateTracking, TrackingPublisher — exactly
 * as SimulationProcessor does, and reimplements none of them. Safety follows for
 * free: an out-of-order/duplicate/stale message is a no-op, a CANCELED/DELIVERED
 * delivery can't be resurrected, and the live path never auto-delivers (no phase
 * maps to DELIVERED — it stops at AWAITING_HANDOFF, like the sim).
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
    private readonly trackingPublisher: TrackingPublisher,
    private readonly deliveriesService: DeliveriesService,
    private readonly i18n: I18nService,
  ) {}

  async ingest(msg: TelemetryMessage): Promise<IngestResult> {
    const { deliveryId, droneId, phase, lat, lng, droneStatus, eta } = msg;

    const hasLat = lat !== undefined && lat !== null;
    const hasLng = lng !== undefined && lng !== null;
    if (hasLat !== hasLng) {
      throw new AppBadRequestException('error.telemetry.latlng_pair_required');
    }

    // The HTTP DTO already bounds-checks, but the ingest core is the shared,
    // transport-agnostic entry point (a future MQTT producer / a direct call has
    // no DTO), so it defends itself: an out-of-bounds fix is dropped rather than
    // written, instead of trusting the caller.
    const positionValid = hasLat && hasLng && this.inBounds(lat, lng);
    if (hasLat && hasLng && !positionValid) {
      this.logger.warn(
        `Dropping out-of-bounds telemetry position (${lat}, ${lng}) for ${deliveryId}`,
      );
    }

    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: {
        id: true,
        createdAt: true,
        status: true,
        trackingSource: true,
        assignedDroneId: true,
        // Owner locale to localize the live-map drone-status label (no extra query).
        user: { select: { locale: true } },
      },
    });
    // Unknown delivery → benign no-op (never an upsert that orphans a tracking row).
    if (!delivery) return { applied: false };
    const locale = delivery.user?.locale ?? null;

    // Telemetry must NEVER drive a simulated delivery — that's the guarantee a
    // sim + a live producer can't both mutate one row (the sim is the only
    // writer for SIMULATED; for LIVE no sim jobs were ever enqueued).
    if (delivery.trackingSource !== TrackingSource.LIVE) {
      throw new AppForbiddenException('error.telemetry.not_live');
    }

    // Stream-to-delivery ownership: a gateway with a valid key still can't drive
    // a delivery it isn't bound to. (LIVE deliveries always get an assignedDroneId
    // at create(), so a missing binding means undrivable, not open.)
    if (!delivery.assignedDroneId || delivery.assignedDroneId !== droneId) {
      throw new AppForbiddenException('error.telemetry.drone_not_assigned');
    }

    // Exception phases (FAILED/RETURNING/RETURNED) are BRANCHES off the happy
    // path — route them to the dedicated exception transitions (which own the
    // conditional CAS + refund/cleanup + comms), NOT the monotonic forward CAS.
    // The LIVE-only + ownership guards above already applied to this frame.
    if (phase && isExceptionPhase(phase)) {
      return this.ingestException(
        deliveryId,
        delivery.createdAt,
        phase,
        msg,
        positionValid,
      );
    }

    // ── Status: monotonic, forward-only CAS (identical to handleStage). A late/
    // duplicate/out-of-order phase, or any phase against a terminal delivery,
    // matches 0 rows → no-op, no regression, no resurrection. ──
    let appliedStatus: DeliveryStatus | undefined;
    if (phase) {
      const target = PHASE_TO_STATUS[phase];
      const { count } = await this.prisma.delivery.updateMany({
        where: { id: deliveryId, status: { in: statusesBefore(target) } },
        data: { status: target },
      });
      if (count > 0) appliedStatus = target;
    }

    // A phase that no-oped means the whole frame is stale/out-of-order — drop its
    // position too, so a stale GPS fix can't rewind the map marker.
    const phaseWasStale = phase !== undefined && appliedStatus === undefined;

    // ── Position. A status-advancing frame carries its arrival/stage position and
    // always writes it (mirrors handleStage, incl. the AWAITING_HANDOFF arrival).
    // A position-only frame mirrors handlePosition: skip a terminal/awaiting/stale
    // delivery so a late ping can't move an arrived/canceled/delivered drone.
    //
    // NOTE: position-only ordering is last-write-wins (no sequence guard), so an
    // out-of-order GPS fix can transiently rewind the live marker. Acceptable for
    // now — the single HTTP producer streams ordered frames; a per-frame seq
    // guard is a future enhancement for a multi-producer / MQTT transport. The
    // phaseWasStale drop below only covers the position that ACCOMPANIES a stale
    // phase frame, not standalone position frames. ──
    let positioned = false;
    if (positionValid) {
      const positionAllowed =
        appliedStatus !== undefined ||
        (!phaseWasStale && !this.isTerminalForPosition(delivery.status));
      if (positionAllowed) {
        await this.safe(() =>
          this.trackingService.updateTracking(deliveryId, delivery.createdAt, {
            droneLat: lat,
            droneLng: lng,
            droneStatus: this.resolveDroneStatus(droneStatus, phase, locale),
            eta: this.parseEta(eta),
          }),
        );
        positioned = true;
      }
    } else if (
      hasLat &&
      hasLng &&
      !this.isTerminalForPosition(delivery.status)
    ) {
      // The frame carried a position but it was DROPPED as out-of-bounds (above).
      // The drone is still transmitting — that's liveness, even if the fix is
      // unusable. Bump tracking.updatedAt WITHOUT moving the marker (all scalars
      // undefined → @updatedAt advances, last good position preserved) so the
      // stuck-delivery watchdog reaps on genuine comms-loss, not a faulting GPS.
      await this.safe(() =>
        this.trackingService.updateTracking(deliveryId, delivery.createdAt, {}),
      );
    }

    // Nothing changed (stale/dup with no usable position) → don't publish a frame.
    if (appliedStatus === undefined && !positioned) {
      return { applied: false };
    }

    await this.trackingPublisher.publishUpdate({
      deliveryId,
      status: appliedStatus,
      droneStatus: this.resolveDroneStatus(droneStatus, phase, locale),
      droneLat: positioned ? lat : undefined,
      droneLng: positioned ? lng : undefined,
    });

    if (appliedStatus) {
      this.logger.log(
        `Delivery ${deliveryId} → ${appliedStatus} (live telemetry)`,
      );
    }
    return { applied: true, status: appliedStatus };
  }

  /**
   * Routes an exception phase to the matching first-class transition. These own
   * the conditional CAS + refund/cleanup + comms; ingest() doesn't run its forward
   * CAS or position write for them. A missing reason defaults sensibly (both are
   * drone-fault → refundable). RETURNED carries no reason — it preserves the one
   * set at the abort.
   */
  private async ingestException(
    deliveryId: string,
    deliveryCreatedAt: Date,
    phase: ExceptionPhase,
    msg: TelemetryMessage,
    positionValid: boolean,
  ): Promise<IngestResult> {
    const status = EXCEPTION_PHASE_TO_STATUS[phase];
    let applied = false;
    if (phase === 'FAILED') {
      applied = await this.deliveriesService.failExceptional(
        deliveryId,
        msg.failureReason ?? DeliveryFailureReason.MECHANICAL,
      );
    } else if (phase === 'RETURNING') {
      applied = await this.deliveriesService.beginReturnToBase(
        deliveryId,
        msg.failureReason ?? DeliveryFailureReason.WEATHER_ABORT,
      );
    } else {
      applied = await this.deliveriesService.completeReturnToBase(deliveryId);
    }

    // Persist the frame's position so the transition carries its coordinate. The
    // DeliveriesService transition already fanned out the STATUS (announceException
    // publishes status without coords); here we write the tracking row so a poll /
    // getTracking reflects the true position — most importantly the RETURNED_TO_BASE
    // final at-base marker, which is otherwise never recorded (a frozen terminal,
    // so no later frame can correct it), and the RETURNING un-freeze leg.
    if (applied && positionValid) {
      await this.safe(() =>
        this.trackingService.updateTracking(deliveryId, deliveryCreatedAt, {
          droneLat: msg.lat,
          droneLng: msg.lng,
          // Exception droneStatus is localized by DeliveriesService.announceException;
          // here we only persist the gateway's own label if it sent one.
          droneStatus: this.resolveDroneStatus(
            msg.droneStatus,
            undefined,
            null,
          ),
          eta: this.parseEta(msg.eta),
        }),
      );
    }
    return { applied, status: applied ? status : undefined };
  }

  private isTerminalForPosition(status: DeliveryStatus): boolean {
    return POSITION_FROZEN_STATUSES.includes(status);
  }

  private inBounds(lat: number, lng: number): boolean {
    return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;
  }

  /** A malformed/date-only eta is dropped (never a NaN Date into Prisma). */
  private parseEta(eta?: string): Date | undefined {
    if (!eta) return undefined;
    const parsed = new Date(eta);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private resolveDroneStatus(
    droneStatus: string | undefined,
    phase: TelemetryMessage['phase'],
    locale: string | null,
  ): string | undefined {
    // A gateway-supplied label wins (the drone's own words). Otherwise, for a
    // happy phase, render the localized map label from the SAME catalog the sim
    // uses (notification.stage.<status>.droneStatus) so LIVE and SIMULATED
    // deliveries show the drone status in the owner's language identically.
    let value = droneStatus;
    if (!value && phase && phase in PHASE_TO_STATUS) {
      value = this.i18n.translate(
        `notification.stage.${PHASE_TO_STATUS[phase as HappyPhase]}.droneStatus`,
        locale,
      );
    }
    return value ? value.slice(0, DRONE_STATUS_MAX_LEN) : undefined;
  }

  /** Side effects are best-effort: a transient tracking-upsert failure must not
   * fail the already-applied (committed) status transition. */
  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(
        `Telemetry side-effect failed: ${(error as Error).message}`,
      );
    }
  }
}
