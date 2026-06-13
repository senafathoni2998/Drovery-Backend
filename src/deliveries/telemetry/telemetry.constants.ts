import { DeliveryStatus } from '@prisma/client';

/**
 * A telemetry message carries a drone PHASE (a small device-vocabulary), NOT a
 * raw DeliveryStatus. Decoupling the wire vocabulary from our internal lifecycle
 * means a drone can never name a forbidden internal state (DELIVERED/CANCELED) —
 * the map below has NO entry that yields DELIVERED, so the live path stops at
 * AWAITING_HANDOFF exactly like the simulation. DELIVERED is reachable only via
 * the recipient handoff OTP (DeliveriesService.confirmHandoff).
 */
export const DRONE_PHASES = [
  'CONFIRMED',
  'ASSIGNED',
  'PICKUP',
  'IN_TRANSIT',
  'ARRIVED',
] as const;

export type DronePhase = (typeof DRONE_PHASES)[number];

/** Phase → DeliveryStatus. Intentionally has no DELIVERED target. */
export const PHASE_TO_STATUS: Record<DronePhase, DeliveryStatus> = {
  CONFIRMED: DeliveryStatus.CONFIRMED,
  ASSIGNED: DeliveryStatus.DRONE_ASSIGNED,
  PICKUP: DeliveryStatus.PICKUP_IN_PROGRESS,
  IN_TRANSIT: DeliveryStatus.IN_TRANSIT,
  ARRIVED: DeliveryStatus.AWAITING_HANDOFF,
};

/** Human-readable drone status used when a message omits its own `droneStatus`. */
export const PHASE_DRONE_STATUS: Record<DronePhase, string> = {
  CONFIRMED: 'Delivery confirmed',
  ASSIGNED: 'Drone assigned',
  PICKUP: 'On the way to Pickup Location',
  IN_TRANSIT: 'En route to destination',
  ARRIVED: 'Awaiting recipient handoff',
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
