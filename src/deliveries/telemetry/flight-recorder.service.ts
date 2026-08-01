import { Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus, DroneCommandType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from '../../metrics/metrics.service';
import { DroneCommandService } from '../commands/drone-command.service';
import { RETURNABLE_STATUSES } from '../delivery-exceptions';
import { assessRecall } from './energy';
import { AUTO_RETURN_COOLDOWN_MS } from './flight-recorder.constants';
import { isExceptionPhase, TelemetryMessage } from './telemetry.constants';

/** Everything the recorder needs about the delivery the frame belongs to. */
export interface RecorderContext {
  deliveryId: string;
  deliveryCreatedAt: Date;
  droneId: string;
  status: DeliveryStatus;
  packageWeight: number;
}

/**
 * The flight recorder, and the only thing in the platform that watches a battery.
 *
 * Three jobs, in the order they must happen:
 *
 *   1. APPEND the frame. `DeliveryTracking` is one row every frame overwrites, so
 *      the last transmission before a loss of comms was already destroyed by the
 *      one after it. This keeps all of them.
 *   2. Push the live state onto the `drones` row, so DISPATCH decides using where
 *      the aircraft actually is and what charge it actually has, rather than the
 *      values someone typed at registration.
 *   3. Decide whether it can still get home, and recall it if not.
 *
 * All three are best-effort and run AFTER the frame's status/position handling has
 * committed. None of them may fail an ingest: a recorder problem must not stop a
 * drone reporting its position, because that stream is what the watchdog uses to
 * tell a flying aircraft from a crashed one.
 */
@Injectable()
export class FlightRecorderService {
  private readonly logger = new Logger(FlightRecorderService.name);

  /** deliveryId → last auto-return attempt. Purely a write-rate damper; see below. */
  private readonly lastAutoReturn = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: DroneCommandService,
    private readonly metrics: MetricsService,
  ) {}

  async record(ctx: RecorderContext, msg: TelemetryMessage): Promise<void> {
    await this.append(ctx, msg);
    await this.updateDroneState(ctx, msg);
    await this.maybeRecall(ctx, msg);
  }

  /**
   * Write the frame exactly as received.
   *
   * NOT filtered by whether the frame was applied. A stale, out-of-order or
   * out-of-bounds frame is still evidence of what the aircraft transmitted and
   * when — and those are precisely the frames an incident review cares about,
   * because they are what a failing GPS or a wedged flight controller looks like
   * from the ground. The log records what was RECEIVED; the live map keeps
   * recording what was ACCEPTED.
   */
  private async append(
    ctx: RecorderContext,
    msg: TelemetryMessage,
  ): Promise<void> {
    try {
      await this.prisma.flightFrame.create({
        data: {
          deliveryId: ctx.deliveryId,
          deliveryCreatedAt: ctx.deliveryCreatedAt,
          droneId: ctx.droneId,
          lat: msg.lat ?? null,
          lng: msg.lng ?? null,
          altitudeM: msg.altitudeM ?? null,
          batteryPercent: msg.batteryPercent ?? null,
          airspeedKph: msg.airspeedKph ?? null,
          phase: msg.phase ?? null,
          droneStatus: msg.droneStatus ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `flight frame append failed for ${ctx.deliveryId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Freshen the aircraft's own row from the frame.
   *
   * Scoped to `activeDeliveryId` rather than the drone id, so a late frame from a
   * finished flight cannot overwrite the position of an aircraft that has since
   * been claimed by a different delivery — the same scoping rule the release uses,
   * for the same reason.
   */
  private async updateDroneState(
    ctx: RecorderContext,
    msg: TelemetryMessage,
  ): Promise<void> {
    const hasPosition = msg.lat != null && msg.lng != null;
    if (!hasPosition && msg.batteryPercent == null) {
      // Nothing to freshen except liveness, and `lastSeenAt` alone is not worth a
      // write on every heartbeat — the tracking row already carries that signal.
      return;
    }

    try {
      await this.prisma.drone.updateMany({
        where: { activeDeliveryId: ctx.deliveryId },
        data: {
          ...(hasPosition ? { currentLat: msg.lat, currentLng: msg.lng } : {}),
          ...(msg.batteryPercent != null
            ? { batteryPercent: msg.batteryPercent }
            : {}),
          lastSeenAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `drone state update failed for ${ctx.deliveryId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Recall the aircraft if it can no longer get home.
   *
   * Needs a battery reading AND a position — a recall decision made without both
   * would be a guess, and the failure mode of guessing wrong in the permissive
   * direction is a drone that does not come back. A fleet whose gateway never
   * sends `batteryPercent` therefore gets no auto-return, which is the honest
   * outcome: the platform will not invent a state of charge.
   *
   * Only fires in RETURNABLE_STATUSES — the states where the drone is airborne and
   * a return flight is a legal transition. Before pickup there is nothing to fly
   * home; after handoff it is already down.
   */
  private async maybeRecall(
    ctx: RecorderContext,
    msg: TelemetryMessage,
  ): Promise<void> {
    if (msg.batteryPercent == null || msg.lat == null || msg.lng == null)
      return;
    // The drone is already reporting an abort/failure — it does not need to be told
    // to come home, and issuing a command against a delivery mid-transition would
    // just collide with the transition the same frame is driving.
    if (msg.phase && isExceptionPhase(msg.phase)) return;
    if (!RETURNABLE_STATUSES.includes(ctx.status)) return;

    // Write-rate damper only. The AUTHORITATIVE dedupe is the partial unique index
    // allowing one open command per delivery, which makes a second issue a 409 —
    // this just stops a 10 Hz stream attempting 10 doomed INSERTs a second while
    // the first command sits unacked. In-process and per-replica by design: it is
    // an optimisation, so it does not need to be correct across replicas, and
    // making it shared state would give it a failure mode it does not deserve.
    const last = this.lastAutoReturn.get(ctx.deliveryId) ?? 0;
    const now = Date.now();
    if (now - last < AUTO_RETURN_COOLDOWN_MS) return;

    const drone = await this.prisma.drone
      .findFirst({
        where: { activeDeliveryId: ctx.deliveryId },
        select: {
          id: true,
          serial: true,
          rangeKm: true,
          maxPayloadKg: true,
          homeBaseLat: true,
          homeBaseLng: true,
        },
      })
      .catch(() => null);
    if (!drone) return;

    const verdict = assessRecall(
      drone,
      { batteryPercent: msg.batteryPercent, lat: msg.lat, lng: msg.lng },
      ctx.packageWeight,
    );
    if (!verdict.recall) return;

    this.lastAutoReturn.set(ctx.deliveryId, now);
    this.logger.warn(
      `AUTO-RETURN ${drone.serial} on delivery ${ctx.deliveryId}: ${verdict.reason} ` +
        `(battery ${msg.batteryPercent}%, ${verdict.distanceHomeKm.toFixed(1)} km from base, ` +
        `${verdict.remainingRangeKm.toFixed(1)} km of usable range left)`,
    );

    try {
      // adminId null — no human issued this. `issuedByUserId` is nullable precisely
      // so the audit row can say "the platform did it", which is more useful than
      // attributing an automated recall to whichever operator happened to be on.
      await this.commands.issue(null, ctx.deliveryId, {
        type: DroneCommandType.RETURN_TO_BASE,
      });
      this.metrics.autoReturnsTotal.inc({ reason: verdict.reason! });
    } catch (e) {
      // A 409 here is the NORMAL outcome of a recall that is already in flight —
      // the open-command index doing its job. Anything else is worth a line, but
      // nothing here may fail the ingest.
      this.logger.warn(
        `auto-return issue failed for ${ctx.deliveryId}: ${(e as Error).message}`,
      );
    }
  }

  /** Drop the cooldown entry once a delivery is finished, so the map cannot grow
   * without bound on a long-lived process. */
  forget(deliveryId: string): void {
    this.lastAutoReturn.delete(deliveryId);
  }
}
