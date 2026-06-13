import { DeliveryFailureReason, DeliveryStatus } from '@prisma/client';

/**
 * Delivery exceptions (P3 #16) — failed drop / weather abort / return-to-base as
 * first-class outcomes. These statuses are BRANCHES off the linear happy path and
 * are deliberately OUTSIDE STATUS_ORDER (simulation.constants.ts), so the monotonic
 * forward CAS can never enter them and a terminal can't be resurrected. Each
 * transition uses its own dedicated conditional CAS (mirroring adminForceCancel).
 */

// In-flight states a delivery may be FAILED from (a drone is dispatched).
// Excludes PENDING/CONFIRMED/SCHEDULED — those are cancel()'s domain
// (CANCELABLE_STATUSES) — and all terminals, so FAIL is strictly an in-flight
// outcome with no overlap with cancel. RETURNING is included so a return flight
// that itself dies (mechanical / lost comms) can still reach a real terminal
// (DELIVERY_FAILED) instead of being stranded in the transient status.
export const FAILABLE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DRONE_ASSIGNED,
  DeliveryStatus.PICKUP_IN_PROGRESS,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.AWAITING_HANDOFF,
  DeliveryStatus.RETURNING,
];

// Settled outcomes that must NEVER be resurrected — no transition (including
// adminForceCancel) may move a delivery out of one. Centralized so a newly added
// terminal can't be forgotten by a no-resurrect guard.
export const TERMINAL_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.CANCELED,
  DeliveryStatus.DELIVERY_FAILED,
  DeliveryStatus.RETURNED_TO_BASE,
];

// States from which the drone can fly the package home (it has the package).
// Not DRONE_ASSIGNED (nothing picked up yet → that's a FAIL, not a return).
export const RETURNABLE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.PICKUP_IN_PROGRESS,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.AWAITING_HANDOFF,
];

// Landed/terminal/arrived states where a stale position frame must NOT move the
// marker (shared by the sim's handlePosition and telemetry's position path).
// RETURNING is intentionally ABSENT — the marker must keep updating as the drone
// flies home.
export const POSITION_FROZEN_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.CANCELED,
  DeliveryStatus.AWAITING_HANDOFF,
  DeliveryStatus.DELIVERED,
  DeliveryStatus.RETURNED_TO_BASE,
  DeliveryStatus.DELIVERY_FAILED,
];

/**
 * A drone/service-fault failure refunds the customer (make them whole); a
 * recipient-fault (no-show / handoff OTP locked) does not — the drone did its job.
 * One obvious switch, easily tuned. OTHER favors the customer (refunds).
 */
export function isDroneFaultReason(reason: DeliveryFailureReason): boolean {
  return reason !== DeliveryFailureReason.RECIPIENT_UNAVAILABLE;
}

export interface ExceptionComms {
  title: string;
  body: string;
  droneStatus: string;
}

// Failure copy keyed by reason (the WHAT is DELIVERY_FAILED, the WHY varies).
const FAILED_COMMS: Record<DeliveryFailureReason, ExceptionComms> = {
  WEATHER_ABORT: {
    title: 'Delivery Aborted — Weather',
    body: 'Unsafe weather forced your drone to abort. Your payment has been refunded to your wallet.',
    droneStatus: 'Aborted — weather',
  },
  MECHANICAL: {
    title: 'Delivery Failed',
    body: 'A technical issue grounded the drone. Your payment has been refunded to your wallet.',
    droneStatus: 'Grounded — technical issue',
  },
  UNSAFE_DROP_ZONE: {
    title: "Couldn't Complete Delivery",
    body: "The drone couldn't find a safe spot to drop your package. Your payment has been refunded.",
    droneStatus: 'Aborted — unsafe drop zone',
  },
  RECIPIENT_UNAVAILABLE: {
    title: 'Handoff Failed',
    body: "We couldn't verify the recipient after several attempts, so the delivery was stopped. Contact support if you need a refund.",
    droneStatus: 'Stopped — recipient unavailable',
  },
  ADMIN_ABORT: {
    title: 'Delivery Stopped',
    body: 'Your delivery was stopped by support. Your payment has been refunded to your wallet.',
    droneStatus: 'Stopped by support',
  },
  OTHER: {
    title: 'Delivery Failed',
    body: "Your delivery couldn't be completed. Your payment has been refunded to your wallet.",
    droneStatus: 'Delivery failed',
  },
};

const RETURNING_COMMS: ExceptionComms = {
  title: 'Drone Returning to Base',
  body: 'Your drone is heading back. You can watch it return live on the map.',
  droneStatus: 'Returning to base',
};

const RETURNED_COMMS: ExceptionComms = {
  title: 'Drone Returned Safely',
  body: 'Your package made it back to base. Your payment has been refunded to your wallet.',
  droneStatus: 'Returned to base',
};

/** The notification + WS copy for an exception transition. */
export function exceptionComms(
  status: DeliveryStatus,
  reason?: DeliveryFailureReason | null,
): ExceptionComms {
  if (status === DeliveryStatus.RETURNING) return RETURNING_COMMS;
  if (status === DeliveryStatus.RETURNED_TO_BASE) return RETURNED_COMMS;
  return FAILED_COMMS[reason ?? DeliveryFailureReason.OTHER];
}
