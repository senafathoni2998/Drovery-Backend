// ==================== PRE-FLIGHT ====================
//
// Serviceability used to be evaluated exactly twice — in the quote and in
// `create()` — and never again. A delivery booked 60 days out was weather-checked
// at BOOKING and then launched by a kickoff job with zero re-check. The check that
// matters is the one immediately before rotor spin-up; every earlier one is a
// forecast, and a two-month-old forecast is not a safety control.

/**
 * How long to wait before re-checking a delivery held on the ground, ms.
 *
 * Sized against what is actually being waited for. A squall line takes tens of
 * minutes to pass and a saturated fleet frees up as flights land, so a 60-second
 * retry would burn attempts on a condition that had no opportunity to change.
 */
export const PREFLIGHT_RETRY_DELAY_MS = 15 * 60_000;

/**
 * How many times a launch is deferred before the delivery is given up on.
 *
 * With the delay above this is a ~1 hour hold. Beyond that the honest answer to a
 * customer is "we could not fly this", not another hour of a delivery sitting in
 * SCHEDULED looking like it is about to happen. A held delivery is failed with a
 * refund, not left to rot.
 */
export const PREFLIGHT_MAX_ATTEMPTS = 4;
