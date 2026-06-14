import {
  DeliveryFailureReason,
  DeliveryStatus,
  DroneCommandStatus,
  DroneCommandType,
} from '@prisma/client';

import { FAILABLE_STATUSES, RETURNABLE_STATUSES } from '../delivery-exceptions';

/**
 * Backend -> drone command channel (P3 follow-on). An ADMIN issues a command, the
 * (mock) drone polls + acks it over the existing /ingest transport, and the ack is
 * the SOLE trigger that drives the delivery via the existing exception transitions.
 */

// A command unacked within this window is presumed undeliverable and must never
// execute late (matches the ingest HMAC freshness posture). expiresAt is stamped
// at issue; poll/ack enforce it lazily so correctness never depends on the sweep.
export const COMMAND_TTL_MS = 5 * 60_000;

// A command claimed (ACKED) but whose delivery transition never landed — a crash
// between the claim and the transition — is reconciled by the watchdog once it has
// been stranded longer than this. Comfortably exceeds the sub-second happy-path
// window between claim and the appliedTransition patch, so a healthy ack is never
// reconciled mid-flight.
export const COMMAND_RECONCILE_GRACE_MS = 2 * 60_000;

// Hard cap on total command rows per delivery (the partial-unique only bounds the
// OPEN set). Bounds append-growth from repeated issue→expire/reject cycles by an
// authorized-but-adversarial admin. Generous — a real flight needs a handful.
export const MAX_COMMANDS_PER_DELIVERY = 50;

// The command-row states that occupy the "one open command per delivery" slot
// (the partial unique index). A command leaves the slot when ACKED/REJECTED/EXPIRED.
export const COMMAND_OPEN_STATUSES: DroneCommandStatus[] = [
  DroneCommandStatus.PENDING,
  DroneCommandStatus.FETCHED,
];

// Each command type maps 1:1 onto an existing DeliveriesService transition; the
// command may only be ISSUED while the delivery is in that transition's legal set
// (the ack-time CAS is still authoritative — this is the fail-fast issue guard).
export const COMMAND_TYPE_TO_LEGAL_STATUSES: Record<
  DroneCommandType,
  DeliveryStatus[]
> = {
  // RETURN_TO_BASE -> beginReturnToBase (drone has the package; flies it home).
  [DroneCommandType.RETURN_TO_BASE]: RETURNABLE_STATUSES,
  // ABORT -> failExceptional (terminal; valid pre-pickup too — nothing to fly home).
  [DroneCommandType.ABORT]: FAILABLE_STATUSES,
};

// The reason stamped onto the delivery when no explicit reason is supplied. Both
// defaults are drone/service-fault (isDroneFaultReason) -> the customer is refunded;
// an operator can override with RECIPIENT_UNAVAILABLE for a non-refunding outcome.
export const COMMAND_TYPE_DEFAULT_REASON: Record<
  DroneCommandType,
  DeliveryFailureReason
> = {
  [DroneCommandType.RETURN_TO_BASE]: DeliveryFailureReason.WEATHER_ABORT,
  [DroneCommandType.ABORT]: DeliveryFailureReason.ADMIN_ABORT,
};
