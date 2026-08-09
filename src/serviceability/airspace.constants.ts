/**
 * The longest TTL this deployment will honor, whatever the env says.
 *
 * Five minutes. The TTL bounds how long a replica may keep serving zone rows it read
 * before it re-reads them, so an unbounded override is an unbounded window in which an
 * operator's new restriction is invisible to every instance but the one that wrote it.
 * `AIRSPACE_CACHE_TTL_MS=999999999` used to be accepted in silence — an eleven-day cache
 * on a safety surface, from a typo no one would ever see.
 *
 * Five minutes is far past any plausible load justification (the default is 30s) and far
 * short of "nobody notices". A value above it is treated exactly like a negative one:
 * rejected in favor of the default, not clamped. Clamping would honor half of an override
 * that was plainly a mistake.
 */
export const AIRSPACE_CACHE_TTL_MAX_MS = 300_000;

/**
 * Resolves a parsed env override against the default, honoring an explicit `0`
 * (no caching, read on every call) and rejecting anything negative, non-finite, or
 * above `AIRSPACE_CACHE_TTL_MAX_MS` in favor of the fallback rather than passing it
 * through.
 *
 * Extracted as a plain function — like `retentionFor` in
 * `partition-maintenance/partition.constants.ts` — so this multi-branch decision
 * (positive / zero / negative / non-finite / absurd) is testable with plain arguments, no
 * env mutation or module reset required. It already got one branch wrong once: the
 * original `Number(env) || 30_000` silently discarded an explicit 0 AND let a
 * negative value through unchecked.
 */
export function resolveAirspaceCacheTtlMs(
  raw: number,
  fallback: number = 30_000,
): number {
  return Number.isFinite(raw) && raw >= 0 && raw <= AIRSPACE_CACHE_TTL_MAX_MS
    ? raw
    : fallback;
}

/** The columns "in force" is decided from. Both bounds null = unbounded on that side. */
export type ZoneInForceInput = {
  active: boolean;
  activeFrom: Date | null;
  activeUntil: Date | null;
};

/**
 * THE definition of a zone being in force: the operator's switch is on AND `now` falls
 * inside the time window. Both bounds are INCLUSIVE — a window is in force at the instant
 * it opens and at the instant it closes.
 *
 * Exported and shared deliberately. Two surfaces answer this question and they must never
 * disagree: `AirspaceService` decides whether a zone blocks a route, and
 * `AdminService.listAirspaceZones` reports `inForce` to the operator console. A console
 * showing protection that the router is not applying — or the reverse — is worse than no
 * console field at all, and two copies of a three-clause predicate is exactly how that
 * happens. One function, two callers, no drift.
 *
 * `active` is part of the predicate even though `AirspaceService` also filters on it in
 * SQL. The SQL `WHERE` is the cheap indexed pre-filter; this is the definition. Leaving
 * `active` out here would make the function correct only for callers that had already
 * applied it, which is the kind of implicit precondition that breaks the next caller.
 */
export function isZoneInForce(zone: ZoneInForceInput, now: Date): boolean {
  const at = now.getTime();
  return (
    zone.active &&
    (zone.activeFrom === null || zone.activeFrom.getTime() <= at) &&
    (zone.activeUntil === null || zone.activeUntil.getTime() >= at)
  );
}

/**
 * How long the ROWS of `airspace_zones` may be served from memory.
 *
 * Serviceability runs on every quote, and this replaced a module constant, so an
 * uncached read would add a DB round trip to a hot path. 30s is chosen so the worst
 * case is small and STATED rather than because the load demands it: writes invalidate
 * immediately on the instance that made them, and this bounds staleness everywhere
 * else. An operator adding an emergency restriction should see it take effect in
 * seconds across the fleet.
 *
 * WHAT THIS DOES AND DOES NOT BOUND — read the first word above again: the cache holds
 * ROWS, not a decision. The time window is evaluated per call against the caller's
 * `now`, AFTER the cache is consulted, so the TTL bounds the visibility of WRITES only.
 * It does not blur the clock. A pre-staged zone whose `activeFrom` crosses `now` comes
 * into force on the very next call, on every instance, with no re-read and no write to
 * hang an invalidation on.
 *
 * That distinction was once the other way round and it mattered: caching the already
 * window-filtered list re-evaluated the window only on a fill, so a zone entering force
 * by the clock stayed unenforced for up to a full TTL everywhere — the one fail-OPEN
 * window in a surface built to fail closed. Moving the filter after the cache is what
 * makes the paragraph above true, so do not move it back.
 *
 * 0 is a valid, honored value: it means "no caching, read on every call". A negative,
 * non-numeric, or absurdly large override (see `AIRSPACE_CACHE_TTL_MAX_MS`) is rejected
 * in favor of the default rather than silently disabling — or indefinitely freezing —
 * the cache.
 */
export const AIRSPACE_CACHE_TTL_MS = resolveAirspaceCacheTtlMs(
  Number(process.env.AIRSPACE_CACHE_TTL_MS),
);
