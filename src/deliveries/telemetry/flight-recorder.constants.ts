// ==================== ENERGY MANAGEMENT ====================
//
// Battery previously did not exist in this system in ANY form — not a telemetry
// field, not a column, not a gate, not a metric. Phase 11 added the column and made
// it a dispatch precondition; this is the other half: the number arriving from the
// aircraft in flight, and something that acts on it.
//
// The mechanism to act was already built and fully tested — RETURN_TO_BASE with
// issue/poll/ack/CAS and a stranded-ack reconciler. Nothing ever computed WHEN to
// fire it except a human clicking in the console. On a live flight that means the
// only battery monitoring in the platform is an operator watching a screen.

/**
 * Below this state of charge the aircraft is recalled regardless of geometry.
 *
 * The range arithmetic is the primary trigger and this is the backstop under it:
 * it fires when the numbers are unreliable rather than unfavourable — a mis-set
 * `rangeKm`, a drone parked closer to home than its telemetry claims, a battery
 * whose remaining-capacity estimate has gone non-linear near the bottom. At 15%
 * a multirotor is minutes from the ground and "the maths said it was fine" is not
 * a defence.
 */
export const CRITICAL_BATTERY_PERCENT = 15;

/**
 * How much of the computed get-home distance to treat as already spent.
 *
 * `usableRangeKm` has already held back its own reserve, so a bare
 * `distanceHome > usableRange` comparison fires exactly as the aircraft begins
 * eating that reserve — correct, but with zero room for the recall itself to be
 * slow. A command has to be issued, polled for, fetched, acked and then flown, and
 * the drone keeps moving AWAY from home for all of it. This margin buys that
 * round trip.
 */
export const RETURN_TRIGGER_MARGIN = 1.15;

/**
 * Minimum gap between auto-return attempts for one delivery, ms.
 *
 * The real dedupe is structural — `drone_commands` has a partial unique index
 * allowing one open command per delivery, so a second issue throws 409 and is
 * swallowed. This only stops a 10 Hz telemetry stream from generating 10 failed
 * INSERTs a second while the first command sits unacked.
 */
export const AUTO_RETURN_COOLDOWN_MS = 30_000;
