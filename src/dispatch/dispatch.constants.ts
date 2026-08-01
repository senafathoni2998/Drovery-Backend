// ==================== DISPATCH TUNING ====================
//
// Every number here is a SAFETY margin, not a preference. They are deliberately
// conservative: the cost of being wrong in one direction is a rejected booking,
// and in the other it is an aircraft that runs out of energy over a city.

/**
 * Live dispatch is opt-in per deployment.
 *
 * OFF (default): every delivery is SIMULATED, exactly as before this module
 * existed — no aircraft is claimed and no fleet is required. This is what dev,
 * CI and every demo deployment run.
 *
 * ON: the platform flies real registered airframes. `create()` asks the engine
 * for one, and a delivery it cannot fly is REJECTED rather than quietly
 * downgraded to a simulation — a customer who is told a drone is coming must
 * not be watching an animation.
 *
 * Read at call time (not at module load) so it is runtime-togglable and testable,
 * matching how SERVICE_AREA_GLOBAL is handled in ServiceabilityService.
 */
export function liveDispatchEnabled(): boolean {
  return process.env.LIVE_DISPATCH === 'true';
}

/**
 * An aircraft below this state-of-charge is not offered a mission at all, even
 * if the arithmetic says the energy is sufficient. Below ~25% a multirotor's
 * voltage sag makes the remaining-range estimate unreliable in exactly the
 * regime where being wrong is unrecoverable.
 */
export const MIN_DISPATCH_BATTERY_PERCENT = 25;

/**
 * Fraction of usable range held back as reserve — for headwind, a go-around at
 * the dropoff, a diversion, and the plain fact that `rangeKm` is a still-air
 * bench figure. A mission is only feasible if it fits in the REMAINING 75%.
 */
export const RANGE_RESERVE_FRACTION = 0.25;

/**
 * How much of an airframe's range a full-rated payload costs it. At the rated
 * maximum the aircraft keeps (1 - 0.35) = 65% of its empty range; at half rating
 * it keeps ~82%. Linear is a simplification of a curve, but it is a
 * CONSERVATIVE one at the light end and roughly right at the heavy end, which is
 * the correct direction for a safety derate.
 */
export const PAYLOAD_RANGE_PENALTY = 0.35;

/**
 * How many ranked candidates the engine will try to claim before giving up.
 * Each attempt is one conditional UPDATE; a loss means another delivery claimed
 * that airframe in the microseconds between ranking and claiming. Losing 8 races
 * in a row means the fleet is saturated, and one more attempt will not help.
 */
export const MAX_CLAIM_ATTEMPTS = 8;

/**
 * Ceiling on how many candidate rows the ranking query pulls. The engine ranks
 * in-process (feasibility needs geometry SQL cannot express), so this bounds the
 * work per booking. Ordered by capacity ascending, so the rows dropped are the
 * heavy-lift airframes we least want to assign anyway.
 */
export const CANDIDATE_LIMIT = 50;
