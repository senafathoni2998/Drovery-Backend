/**
 * Deterministic shard routing keyed by deliveryId.
 *
 * WHY: at 1M+ the single Postgres primary and the single Redis pub/sub node are
 * the binding write/fan-out ceilings (see loadtest/capacity-model-1m.mjs). The
 * fix is to fan those onto N shards. A shard FUNCTION must be:
 *   - STABLE across processes — the worker that publishes a position frame and the
 *     api replica that subscribes to it MUST compute the SAME shard for the same
 *     deliveryId, or the subscriber listens on the wrong instance.
 *   - INDEPENDENT of partition keys — Delivery is RANGE(createdAt)-partitioned for
 *     storage/retention; the WRITE-shard is a DIFFERENT axis (load), so it hashes
 *     the stable id, not createdAt.
 *
 * This is a pure, dependency-free FNV-1a 32-bit hash → modulo shard count, so it
 * matches in Node, in a SQL routing layer, or in a sidecar. It is the seam a future
 * Citus/Aurora-Limitless write-router (wrapping prisma.service.ts) and a sharded
 * pub/sub backend (replacing the single channel in tracking.publisher.ts) both key
 * off — introduced now, inert until shardCount > 1.
 */

/** FNV-1a 32-bit — fast, well-distributed, identical output in any language. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit unsigned via Math.imul + >>> 0.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Maps a deliveryId to a shard index in [0, shardCount). shardCount=1 (the default
 * today) ALWAYS returns 0 — so introducing this util changes nothing until a deploy
 * sets shardCount > 1. Throws on a non-positive shardCount (a misconfigured fan-out
 * must fail loud, never silently route everything to shard 0 under a "sharded" flag).
 */
export function deliveryShard(deliveryId: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(
      `deliveryShard: shardCount must be a positive integer, got ${shardCount}`,
    );
  }
  if (shardCount === 1) return 0;
  return fnv1a32(deliveryId) % shardCount;
}

/**
 * Sharded pub/sub channel name: appends the shard so each shard's publisher and
 * subscriber meet on a distinct channel/instance. shardCount=1 yields the LEGACY
 * unsharded name unchanged (`delivery:<id>:update`), so the rollout is additive and
 * the existing trackingChannel() contract is preserved until a deploy opts in.
 */
export function shardedTrackingChannel(
  deliveryId: string,
  shardCount: number,
): string {
  const base = `delivery:${deliveryId}:update`;
  if (shardCount === 1) return base;
  return `s${deliveryShard(deliveryId, shardCount)}:${base}`;
}
