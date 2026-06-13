import { DeliveryFailureReason, DeliveryStatus } from '@prisma/client';

/**
 * A telemetry message carries a drone PHASE (a small device-vocabulary), NOT a
 * raw DeliveryStatus. Decoupling the wire vocabulary from our internal lifecycle
 * means a drone can never name a forbidden internal state (DELIVERED/CANCELED) —
 * the happy-path map below has NO entry that yields DELIVERED, so the live path
 * stops at AWAITING_HANDOFF exactly like the simulation. DELIVERED is reachable
 * only via the recipient handoff OTP (DeliveriesService.confirmHandoff).
 */
export const HAPPY_PHASES = [
  'CONFIRMED',
  'ASSIGNED',
  'PICKUP',
  'IN_TRANSIT',
  'ARRIVED',
] as const;

// Exception phases — a drone reporting an aborted/failed/returning flight. Kept
// SEPARATE from the happy-path map so PHASE_TO_STATUS stays linear + DELIVERED-free;
// these route to the dedicated exception transitions (DeliveriesService), not the
// monotonic forward CAS.
export const EXCEPTION_PHASES = ['FAILED', 'RETURNING', 'RETURNED'] as const;

export const DRONE_PHASES = [...HAPPY_PHASES, ...EXCEPTION_PHASES] as const;

export type HappyPhase = (typeof HAPPY_PHASES)[number];
export type ExceptionPhase = (typeof EXCEPTION_PHASES)[number];
export type DronePhase = (typeof DRONE_PHASES)[number];

export function isExceptionPhase(phase: DronePhase): phase is ExceptionPhase {
  return (EXCEPTION_PHASES as readonly string[]).includes(phase);
}

/** Happy-path phase → DeliveryStatus. Intentionally has no DELIVERED target. */
export const PHASE_TO_STATUS: Record<HappyPhase, DeliveryStatus> = {
  CONFIRMED: DeliveryStatus.CONFIRMED,
  ASSIGNED: DeliveryStatus.DRONE_ASSIGNED,
  PICKUP: DeliveryStatus.PICKUP_IN_PROGRESS,
  IN_TRANSIT: DeliveryStatus.IN_TRANSIT,
  ARRIVED: DeliveryStatus.AWAITING_HANDOFF,
};

/** Exception phase → the (branch) DeliveryStatus it drives. */
export const EXCEPTION_PHASE_TO_STATUS: Record<ExceptionPhase, DeliveryStatus> = {
  FAILED: DeliveryStatus.DELIVERY_FAILED,
  RETURNING: DeliveryStatus.RETURNING,
  RETURNED: DeliveryStatus.RETURNED_TO_BASE,
};

/** The transport-agnostic telemetry message both the HTTP and MQTT paths produce. */
export interface TelemetryMessage {
  deliveryId: string;
  droneId: string;
  phase?: DronePhase;
  lat?: number;
  lng?: number;
  droneStatus?: string;
  eta?: string;
  // Only meaningful for exception phases (FAILED/RETURNING) — why it ended.
  failureReason?: DeliveryFailureReason;
}

// Header names for the ingest endpoint's machine auth.
export const INGEST_KEY_HEADER = 'x-ingest-key';
export const INGEST_SIGNATURE_HEADER = 'x-ingest-signature';
// Unix-ms timestamp the HMAC is bound to; a frame outside the tolerance window is
// rejected as stale/replayed (the same anti-replay posture as the Stripe webhook).
export const INGEST_TIMESTAMP_HEADER = 'x-ingest-timestamp';
export const INGEST_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

// Coordinate bounds — enforced by the DTO for the HTTP path AND by the ingest
// core, so any transport (a future MQTT producer / a direct call) is self-defending.
export const LAT_MIN = -90;
export const LAT_MAX = 90;
export const LNG_MIN = -180;
export const LNG_MAX = 180;
export const DRONE_STATUS_MAX_LEN = 120;
