// ==================== FLIGHT FEASIBILITY ====================
//
// Pure geometry + energy arithmetic. No I/O, no Prisma, no Nest — so it can be
// tested exhaustively and so the expensive part of dispatch (deciding whether an
// aircraft can actually complete a mission) is never entangled with the claim.
//
// The question this file answers is NOT "is the delivery short enough". It is:
// "can THIS airframe, from where it is standing, with the charge it currently
// has, carrying THIS package, fly to the pickup, on to the dropoff, and still
// get home?" A drone that reaches the dropoff and cannot return is not a
// successful delivery, it is a crash site with a parcel next to it.

import { haversineKm } from '../common/geo-distance';
import {
  MIN_DISPATCH_BATTERY_PERCENT,
  PAYLOAD_RANGE_PENALTY,
  RANGE_RESERVE_FRACTION,
} from './dispatch.constants';

/** The subset of a Drone row feasibility needs. Keeps this file Prisma-free. */
export interface FeasibilityAircraft {
  id: string;
  maxPayloadKg: number;
  rangeKm: number;
  batteryPercent: number;
  homeBaseLat: number;
  homeBaseLng: number;
  currentLat: number | null;
  currentLng: number | null;
}

export interface MissionRoute {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

/**
 * Total distance the aircraft actually flies for this mission — three legs, not
 * one:
 *
 *   1. POSITIONING  where it is now → pickup
 *   2. DELIVERY     pickup → dropoff
 *   3. RECOVERY     dropoff → home base
 *
 * Leg 1 is the one that is easy to forget and the one that most often makes a
 * short delivery infeasible: a 2 km hop is cheap unless the only free airframe
 * is parked 15 km away. Leg 3 is non-negotiable — an aircraft that cannot get
 * home is not available for the mission regardless of how close the dropoff is.
 *
 * Position falls back to the home base when the aircraft has never reported
 * telemetry (`currentLat/Lng` are null until the first frame), which is the
 * correct assumption: a drone that has never flown is sitting on its pad.
 */
export function missionDistanceKm(
  drone: FeasibilityAircraft,
  route: MissionRoute,
): number {
  const startLat = drone.currentLat ?? drone.homeBaseLat;
  const startLng = drone.currentLng ?? drone.homeBaseLng;

  const positioning = haversineKm(
    startLat,
    startLng,
    route.fromLat,
    route.fromLng,
  );
  const delivery = haversineKm(
    route.fromLat,
    route.fromLng,
    route.toLat,
    route.toLng,
  );
  const recovery = haversineKm(
    route.toLat,
    route.toLng,
    drone.homeBaseLat,
    drone.homeBaseLng,
  );

  return positioning + delivery + recovery;
}

/**
 * How far this aircraft can be trusted to fly RIGHT NOW with this payload,
 * after three reductions applied in order:
 *
 *   rangeKm            still-air, empty, full charge (a bench figure)
 *   × battery%         it is not full; it is as full as it is
 *   × payload derate   lift costs energy, proportional to rated load
 *   × (1 - reserve)    what is left after the margin we refuse to spend
 *
 * Returns 0 for a nonsensical airframe (non-positive range or capacity) rather
 * than a negative or NaN budget, so a bad fleet row can only ever make an
 * aircraft ineligible — never accidentally eligible.
 */
export function usableRangeKm(
  drone: FeasibilityAircraft,
  payloadKg: number,
): number {
  if (!(drone.rangeKm > 0) || !(drone.maxPayloadKg > 0)) return 0;

  const charge = Math.max(0, Math.min(100, drone.batteryPercent)) / 100;

  // Payload fraction is clamped to 1: an over-rated package is rejected by the
  // capacity check, and it must not produce a derate above 100% here.
  const loadFraction = Math.min(1, Math.max(0, payloadKg) / drone.maxPayloadKg);
  const payloadDerate = 1 - PAYLOAD_RANGE_PENALTY * loadFraction;

  return drone.rangeKm * charge * payloadDerate * (1 - RANGE_RESERVE_FRACTION);
}

export type InfeasibleReason = 'CAPACITY' | 'BATTERY' | 'RANGE';

export interface FeasibilityVerdict {
  feasible: boolean;
  /** Absent when feasible. Which single check failed first. */
  reason?: InfeasibleReason;
  /** Always populated — used to rank the candidates that DID pass. */
  missionKm: number;
}

/**
 * The whole decision for one aircraft, in check order (cheapest and most
 * decisive first):
 *
 *   CAPACITY  it physically cannot lift this          → hard, never retryable
 *   BATTERY   too flat to trust the range estimate    → retryable after a charge
 *   RANGE     it could lift it but not get it there   → retryable, or another airframe
 *
 * The order matters for the caller: CAPACITY is the only reason that is a
 * property of the FLEET rather than of this moment, and it is what lets the
 * caller tell a customer "this package is too heavy for us" instead of the
 * useless "try again later".
 */
export function assessFeasibility(
  drone: FeasibilityAircraft,
  route: MissionRoute,
  payloadKg: number,
): FeasibilityVerdict {
  const missionKm = missionDistanceKm(drone, route);

  if (!(drone.maxPayloadKg >= payloadKg)) {
    return { feasible: false, reason: 'CAPACITY', missionKm };
  }
  if (drone.batteryPercent < MIN_DISPATCH_BATTERY_PERCENT) {
    return { feasible: false, reason: 'BATTERY', missionKm };
  }
  if (missionKm > usableRangeKm(drone, payloadKg)) {
    return { feasible: false, reason: 'RANGE', missionKm };
  }

  return { feasible: true, missionKm };
}

export interface RankedCandidate {
  drone: FeasibilityAircraft;
  missionKm: number;
}

/**
 * Rank the feasible aircraft best-first.
 *
 * Primary key is SMALLEST SUFFICIENT CAPACITY, not nearest. Sending the 5 kg
 * heavy-lift airframe to carry a 200 g envelope is locally optimal and globally
 * wrong: it is the only aircraft that can take the next heavy booking, and while
 * it is out carrying an envelope that booking gets rejected. Preserving scarce
 * capability beats saving a few hundred metres of positioning flight.
 *
 * Distance is the tie-break, so among equally-capable airframes the nearest one
 * goes — which is both the cheapest mission and the one that leaves the rest of
 * the fleet spread across the service area.
 */
export function rankCandidates(
  drones: FeasibilityAircraft[],
  route: MissionRoute,
  payloadKg: number,
): RankedCandidate[] {
  const feasible: RankedCandidate[] = [];

  for (const drone of drones) {
    const verdict = assessFeasibility(drone, route, payloadKg);
    if (verdict.feasible) {
      feasible.push({ drone, missionKm: verdict.missionKm });
    }
  }

  return feasible.sort(
    (a, b) =>
      a.drone.maxPayloadKg - b.drone.maxPayloadKg ||
      a.missionKm - b.missionKm ||
      // Final tie-break on id so ranking is deterministic — otherwise two
      // identical airframes order by however the DB returned them, and a test
      // asserting which one is claimed is flaky rather than wrong.
      a.drone.id.localeCompare(b.drone.id),
  );
}
