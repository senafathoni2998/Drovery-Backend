/**
 * Resolves a parsed env override against the default, honoring an explicit `0`
 * (no caching, read on every call) and rejecting anything negative or non-finite
 * in favor of the fallback rather than passing it through.
 *
 * Extracted as a plain function — like `retentionFor` in
 * `partition-maintenance/partition.constants.ts` — so this multi-branch decision
 * (positive / zero / negative / non-finite) is testable with plain arguments, no env
 * mutation or module reset required. It already got one branch wrong once: the
 * original `Number(env) || 30_000` silently discarded an explicit 0 AND let a
 * negative value through unchecked.
 */
export function resolveAirspaceCacheTtlMs(
  raw: number,
  fallback: number = 30_000,
): number {
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/**
 * How long an in-force zone list may be served from memory.
 *
 * Serviceability runs on every quote, and this replaced a module constant, so an
 * uncached read would add a DB round trip to a hot path. 30s is chosen so the worst
 * case is small and STATED rather than because the load demands it: writes invalidate
 * immediately on the instance that made them, and this bounds staleness everywhere
 * else. An operator adding an emergency restriction should see it take effect in
 * seconds across the fleet.
 *
 * That invalidate-on-write mechanism does NOT cover a zone whose `activeFrom` is in
 * the future: it becomes in force purely by the clock crossing that timestamp, with
 * no write happening at that moment to invalidate anything. Such a zone can go
 * unenforced for up to a full TTL after its window opens — the general staleness
 * bound above covers this case, but the "writes invalidate immediately" mechanism
 * specifically does not.
 *
 * 0 is a valid, honored value: it means "no caching, read on every call". A negative
 * or non-numeric override is rejected in favor of the default rather than silently
 * disabling the cache.
 */
export const AIRSPACE_CACHE_TTL_MS = resolveAirspaceCacheTtlMs(
  Number(process.env.AIRSPACE_CACHE_TTL_MS),
);
