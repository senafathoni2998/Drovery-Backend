/**
 * How long an in-force zone list may be served from memory.
 *
 * Serviceability runs on every quote, and this replaced a module constant, so an
 * uncached read would add a DB round trip to a hot path. 30s is chosen so the worst
 * case is small and STATED rather than because the load demands it: writes invalidate
 * immediately on the instance that made them, and this bounds staleness everywhere
 * else. An operator adding an emergency restriction should see it take effect in
 * seconds across the fleet.
 */
export const AIRSPACE_CACHE_TTL_MS =
  Number(process.env.AIRSPACE_CACHE_TTL_MS) || 30_000;
