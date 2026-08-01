// ==================== THE RECALL DECISION ====================
//
// Pure arithmetic, deliberately separated from the ingest path: deciding whether an
// aircraft still has the energy to reach its base is the one calculation in this
// system whose failure mode is a drone on someone's roof, and it should be testable
// without a database, a delivery or a telemetry frame.

import { haversineKm } from '../../common/geo-distance';
import { usableRangeKm } from '../../dispatch/flight-feasibility';
import {
  CRITICAL_BATTERY_PERCENT,
  RETURN_TRIGGER_MARGIN,
} from './flight-recorder.constants';

/** What the decision needs to know about the airframe. */
export interface EnergyAircraft {
  maxPayloadKg: number;
  rangeKm: number;
  homeBaseLat: number;
  homeBaseLng: number;
}

export interface EnergyReading {
  batteryPercent: number;
  lat: number;
  lng: number;
}

export type RecallReason = 'CRITICAL_BATTERY' | 'INSUFFICIENT_RANGE_HOME';

export interface RecallVerdict {
  recall: boolean;
  reason?: RecallReason;
  /** Straight-line distance to the home base, km. Always populated, for the log. */
  distanceHomeKm: number;
  /** What the aircraft can still fly at this charge, after reserve and payload derate. */
  remainingRangeKm: number;
}

/**
 * Should this aircraft be told to come home right now?
 *
 * Two independent triggers, checked in that order:
 *
 *   CRITICAL_BATTERY          state of charge alone, no geometry involved
 *   INSUFFICIENT_RANGE_HOME   what it can still fly no longer covers the way back
 *
 * The second is the real one and the first is the backstop beneath it, because the
 * second is only as good as `rangeKm` and the reported position. If either is wrong
 * — a mis-set fleet row, a stale GPS fix — the geometry check can happily conclude
 * a flat aircraft is fine. Charge is the one input that cannot be wrong about
 * itself.
 *
 * Reuses `usableRangeKm` so the recall threshold and the DISPATCH threshold cannot
 * drift apart: an aircraft is sent out on a budget, and recalled when that same
 * budget stops covering the return. Two separate energy models would eventually
 * disagree, and the disagreement would be discovered in the field.
 */
export function assessRecall(
  drone: EnergyAircraft,
  reading: EnergyReading,
  payloadKg: number,
): RecallVerdict {
  const distanceHomeKm = haversineKm(
    reading.lat,
    reading.lng,
    drone.homeBaseLat,
    drone.homeBaseLng,
  );
  const remainingRangeKm = usableRangeKm(
    {
      rangeKm: drone.rangeKm,
      maxPayloadKg: drone.maxPayloadKg,
      batteryPercent: reading.batteryPercent,
    },
    payloadKg,
  );

  if (reading.batteryPercent <= CRITICAL_BATTERY_PERCENT) {
    return {
      recall: true,
      reason: 'CRITICAL_BATTERY',
      distanceHomeKm,
      remainingRangeKm,
    };
  }

  // The margin is applied to the DISTANCE, not the range: it inflates how far the
  // aircraft is treated as being from home, which is the conservative direction.
  // Applying it to the range instead would make a low battery look better.
  if (distanceHomeKm * RETURN_TRIGGER_MARGIN > remainingRangeKm) {
    return {
      recall: true,
      reason: 'INSUFFICIENT_RANGE_HOME',
      distanceHomeKm,
      remainingRangeKm,
    };
  }

  return { recall: false, distanceHomeKm, remainingRangeKm };
}
