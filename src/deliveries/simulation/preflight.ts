// ==================== THE PRE-FLIGHT VERDICT ====================
//
// Pure classification, no I/O: given a serviceability result, what should the
// launch do? Separated from the processor so the decision is testable without a
// queue, a database or a delivery, and so the three outcomes are enumerated in one
// place rather than inferred from a chain of ifs at a call site.

import { DeliveryFailureReason } from '@prisma/client';

import { ServiceabilityResult } from '../../serviceability/serviceability.types';

export type PreflightAction =
  /** Conditions are good. Launch. */
  | 'LAUNCH'
  /** Transient — hold on the ground and look again later. */
  | 'HOLD'
  /** Will not become true by waiting. Fail the delivery and refund. */
  | 'ABORT';

export interface PreflightVerdict {
  action: PreflightAction;
  /** Present for HOLD and ABORT — the blocking serviceability code. */
  code?: string;
  /** Present for ABORT — what the delivery is stamped with. */
  reason?: DeliveryFailureReason;
}

/**
 * Classify a serviceability result for a launch decision.
 *
 * The distinction that matters is HOLD vs ABORT, and it is exactly the
 * `weatherHold` flag the serviceability layer already computes: weather is the
 * only transient blocker. A no-fly zone, an out-of-area endpoint or a route longer
 * than any drone can fly will be just as true in an hour — holding for those is a
 * delivery quietly sitting in SCHEDULED, looking to its customer like it is about
 * to happen, until it silently expires.
 *
 * The reasons that reach ABORT are all service-fault, so `isDroneFaultReason` is
 * true for each and the customer is refunded. That is correct: nothing here is the
 * customer's doing — they booked a delivery we accepted and then could not fly.
 */
export function classifyPreflight(
  result: ServiceabilityResult,
): PreflightVerdict {
  if (result.serviceable) return { action: 'LAUNCH' };

  if (result.weatherHold) {
    return {
      action: 'HOLD',
      code: result.codes.find((c) => c.startsWith('WEATHER')),
      reason: DeliveryFailureReason.WEATHER_ABORT,
    };
  }

  const code = result.codes.find((c) => !c.startsWith('WEATHER'));
  return {
    action: 'ABORT',
    code,
    // A route that is out of area, restricted or simply too far is not a
    // mechanical fault and not the recipient's — UNSAFE_DROP_ZONE is the closest
    // honest reading of "we cannot legally or physically fly this to there".
    reason:
      code === 'NO_FLY_ZONE'
        ? DeliveryFailureReason.UNSAFE_DROP_ZONE
        : DeliveryFailureReason.OTHER,
  };
}

/**
 * A launch held too many times is failed rather than held forever.
 *
 * Deliberately a separate decision from `classifyPreflight`: whether the weather
 * is bad and whether we have run out of patience are different questions, and
 * folding them together made the retry budget invisible at the call site.
 */
export function holdExhausted(attempt: number, maxAttempts: number): boolean {
  return attempt + 1 >= maxAttempts;
}
