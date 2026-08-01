import { HttpException, Injectable, Logger } from '@nestjs/common';
import { DroneStatus, TrackingSource } from '@prisma/client';

import {
  AppBadRequestException,
  AppConflictException,
} from '../common/exceptions/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  CANDIDATE_LIMIT,
  liveDispatchEnabled,
  MAX_CLAIM_ATTEMPTS,
  MIN_DISPATCH_BATTERY_PERCENT,
} from './dispatch.constants';
import { MissionRoute, rankCandidates } from './flight-feasibility';

export interface DispatchRequest {
  /** The delivery being dispatched. Becomes the aircraft's claim token. */
  deliveryId: string;
  payloadKg: number;
  /** Null on any leg when the address could not be geocoded. */
  route: Partial<MissionRoute>;
  /** A future pickup window — nothing is claimed now. */
  isScheduled: boolean;
}

export interface DispatchDecision {
  trackingSource: TrackingSource;
  /** The claimed airframe, or null for a SIMULATED delivery. */
  droneId: string | null;
}

/**
 * Why an aircraft is being handed back. Determines whether it rejoins the
 * dispatchable pool or is taken out of service.
 */
export type ReleaseOutcome =
  /** Mission ended normally (delivered, or the return flight landed). */
  | 'RETURN_TO_FLEET'
  /** The aircraft is implicated — lost comms, mechanical. A human looks at it. */
  | 'GROUND_FOR_INSPECTION';

/** No airframe in the fleet can lift this payload — waiting will not change it. */
export const DISPATCH_NO_CAPACITY_KEY = 'error.delivery.dispatch.no_capacity';
/** Nothing free right now: busy, flat, or parked too far away. Transient. */
export const DISPATCH_UNAVAILABLE_KEY = 'error.delivery.dispatch.unavailable';

/**
 * Can waiting fix this refusal?
 *
 * The same transient/permanent split the pre-flight check makes, asked of the
 * FLEET instead of the weather — so a caller that can hold a launch on the
 * ground (the kickoff job) can hold it for a saturated fleet too, and give up
 * immediately on one that will never have a big enough aircraft. Lives next to
 * the throw so the two cannot drift apart.
 */
export function isPermanentDispatchRefusal(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { messageKey?: string }).messageKey === DISPATCH_NO_CAPACITY_KEY
  );
}

/**
 * Chooses which aircraft flies a delivery, and claims it.
 *
 * This exists because nothing used to choose. `assignedDroneId` was
 * `drone-${uuidv4()}` — an id referencing no row — and once that was replaced by
 * a real foreign key the CALLER still named the airframe, via a `droneId` field
 * on the public create DTO that any authenticated customer could set. Selecting
 * your own aircraft is not a feature; it is the operator's job leaking into the
 * customer's request body.
 *
 * The engine owns the whole claim lifecycle — selection, the atomic claim, and
 * the release — because those three have to agree about what a claim MEANS, and
 * they did not when the release lived somewhere else: a successful delivery
 * never released at all (the fleet leaked one airframe per success) and an
 * aborted one released while the drone was still airborne on its way home.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Decide how this delivery is flown, claiming an airframe if it is a live one.
   *
   * Returns SIMULATED — claiming nothing — in the two cases where there is no
   * real flight to dispatch:
   *
   *   - live dispatch is off for this deployment (the default), or
   *   - the pickup is scheduled for a future window. You do not hold an airframe
   *     out of service for three weeks; a scheduled flight is dispatched at its
   *     kickoff, which is Phase 12 work. Until then a scheduled delivery runs the
   *     simulation exactly as it did before this module existed.
   *
   * Otherwise it selects and claims, or THROWS. It never silently downgrades a
   * live delivery to a simulation: a customer told a real drone is coming must
   * not be watching an animation of one.
   */
  async dispatch(req: DispatchRequest): Promise<DispatchDecision> {
    if (!liveDispatchEnabled() || req.isScheduled) {
      return { trackingSource: TrackingSource.SIMULATED, droneId: null };
    }

    const route = this.requireRoute(req.route);
    const droneId = await this.selectAndClaim(
      req.deliveryId,
      route,
      req.payloadKg,
    );

    return { trackingSource: TrackingSource.LIVE, droneId };
  }

  /**
   * Hand the aircraft back. Idempotent, and scoped to THIS delivery's claim — so
   * a late or duplicated release can never free an airframe that has since been
   * claimed by another delivery.
   *
   * `GROUND_FOR_INSPECTION` clears `airworthy` as well as parking the aircraft in
   * MAINTENANCE. Only clearing the status would leave it dispatchable the moment
   * an operator flipped it back to AVAILABLE without anyone having looked at it,
   * and the airframes that reach here are the ones that went silent mid-flight.
   *
   * Best-effort by design: this runs inside terminal-path cleanup, where every
   * step is idempotent and a failure must not abort the transition that already
   * committed. A leaked claim is recoverable by an operator; a delivery stuck
   * half-terminated is not.
   */
  async release(deliveryId: string, outcome: ReleaseOutcome): Promise<void> {
    const grounded = outcome === 'GROUND_FOR_INSPECTION';

    await this.prisma.drone
      .updateMany({
        where: { activeDeliveryId: deliveryId },
        data: {
          activeDeliveryId: null,
          status: grounded ? DroneStatus.MAINTENANCE : DroneStatus.AVAILABLE,
          ...(grounded ? { airworthy: false } : {}),
        },
      })
      .then(({ count }) => {
        if (count > 0 && grounded) {
          this.logger.warn(
            `Aircraft released from delivery ${deliveryId} and GROUNDED for inspection`,
          );
        }
      })
      .catch((e) =>
        this.logger.warn(
          `drone release failed for ${deliveryId}: ${(e as Error).message}`,
        ),
      );
  }

  // ── selection ──────────────────────────────────────────────

  /**
   * Rank the fleet, then claim down the ranking until one sticks.
   *
   * Ranking is a read and the claim is a write, so between them another booking
   * can take the airframe we picked. That is not an error to retry from the top —
   * it is the normal outcome of two customers booking at once — so a lost race
   * just moves to the next candidate. The claim's WHERE carries every precondition
   * (airworthy, available, unclaimed, big enough), which is what makes the loser
   * match zero rows instead of both winning.
   */
  private async selectAndClaim(
    deliveryId: string,
    route: MissionRoute,
    payloadKg: number,
  ): Promise<string> {
    // Re-entrant by design. `activeDeliveryId` is UNIQUE, so a caller that claimed
    // and then died before recording the claim — a BullMQ retry, a re-run create()
    // — would otherwise rank a DIFFERENT airframe, and writing a second claim for
    // the same delivery raises P2002. That turns a recoverable blip into a
    // deterministic failure on every remaining attempt, with the first aircraft
    // held out of service permanently. If this delivery already holds one, that IS
    // its aircraft.
    const held = await this.prisma.drone.findFirst({
      where: { activeDeliveryId: deliveryId },
      select: { id: true },
    });
    if (held) {
      this.logger.log(
        `Delivery ${deliveryId} already holds drone ${held.id} — reusing the claim`,
      );
      return held.id;
    }

    const available = await this.prisma.drone.findMany({
      where: {
        airworthy: true,
        status: DroneStatus.AVAILABLE,
        activeDeliveryId: null,
        maxPayloadKg: { gte: payloadKg },
        batteryPercent: { gte: MIN_DISPATCH_BATTERY_PERCENT },
        // A lapsed inspection grounds an aircraft whether or not anyone has got
        // round to flipping `airworthy`.
        OR: [
          { maintenanceDueAt: null },
          { maintenanceDueAt: { gt: new Date() } },
        ],
      },
      select: {
        id: true,
        maxPayloadKg: true,
        rangeKm: true,
        batteryPercent: true,
        homeBaseLat: true,
        homeBaseLng: true,
        currentLat: true,
        currentLng: true,
      },
      // Ascending capacity, so if the fleet is larger than CANDIDATE_LIMIT the
      // rows dropped are the heavy-lift airframes ranking would rank last anyway.
      orderBy: [{ maxPayloadKg: 'asc' }, { id: 'asc' }],
      take: CANDIDATE_LIMIT,
    });

    const ranked = rankCandidates(available ?? [], route, payloadKg);

    for (const { drone, missionKm } of ranked.slice(0, MAX_CLAIM_ATTEMPTS)) {
      const { count } = await this.prisma.drone.updateMany({
        where: {
          id: drone.id,
          airworthy: true,
          status: DroneStatus.AVAILABLE,
          activeDeliveryId: null,
          maxPayloadKg: { gte: payloadKg },
        },
        data: {
          activeDeliveryId: deliveryId,
          status: DroneStatus.IN_FLIGHT,
        },
      });

      if (count > 0) {
        this.logger.log(
          `Dispatched drone ${drone.id} for delivery ${deliveryId} ` +
            `(${missionKm.toFixed(1)} km mission, ${payloadKg} kg)`,
        );
        return drone.id;
      }
    }

    throw await this.saturationError(payloadKg, ranked.length);
  }

  /**
   * Distinguish "we cannot carry this at all" from "not right now".
   *
   * The difference is the only thing the customer can act on: a package heavier
   * than anything in the fleet will still be too heavy in an hour, and telling
   * them to retry is a lie. Everything else — busy, flat, parked too far away —
   * collapses into ONE message on purpose. Which airframes are airworthy, charged
   * or already flying is fleet information, and this path is reachable by any
   * authenticated customer.
   *
   * Only runs when we are already rejecting, so the extra count costs nothing on
   * the happy path.
   */
  private async saturationError(
    payloadKg: number,
    feasibleCount: number,
  ): Promise<AppConflictException> {
    if (feasibleCount === 0) {
      const capable = await this.prisma.drone
        .count({ where: { airworthy: true, maxPayloadKg: { gte: payloadKg } } })
        .catch(() => 1); // On a count failure, prefer the vaguer message.

      if (capable === 0) {
        this.logger.warn(
          `No airworthy aircraft in the fleet can lift ${payloadKg} kg`,
        );
        return new AppConflictException(DISPATCH_NO_CAPACITY_KEY, {
          weightKg: payloadKg,
        });
      }
    }

    this.logger.warn(
      `Fleet saturated: no aircraft could be claimed for a ${payloadKg} kg delivery`,
    );
    return new AppConflictException(DISPATCH_UNAVAILABLE_KEY);
  }

  /**
   * A live flight needs four real coordinates. Feasibility is entirely geometric,
   * so an ungeocoded address is not a degraded input — there is nothing to
   * compute. The simulated path tolerates missing coords; a real one cannot.
   */
  private requireRoute(route: Partial<MissionRoute>): MissionRoute {
    const { fromLat, fromLng, toLat, toLng } = route;
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
      throw new AppBadRequestException(
        'error.delivery.serviceability.unresolved_location',
      );
    }
    return { fromLat, fromLng, toLat, toLng };
  }
}
