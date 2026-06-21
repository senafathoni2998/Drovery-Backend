import { WATCHDOG_SILENCE_MS } from '../../delivery-watchdog/watchdog.constants';

// ── The tracking hot-store: offload the high-frequency drone-POSITION write off the
// Postgres primary (SCALING-1M.md §3). When ON, TrackingService.updateTracking writes
// the latest position to a Redis hot key (instead of a per-tick deliveryTracking
// UPSERT) and marks the delivery dirty; a worker-tier checkpoint scan periodically
// drains the dirty set into Postgres in one batched upsert per delivery — collapsing
// ~12 sim upserts/delivery (far more for a fast LIVE drone) to one per interval.
//
// Status transitions stay in Postgres (this only moves the position SCALAR), and the
// WS publish + payload are unchanged. Default OFF = today's synchronous write-through,
// byte-identical. ─────────────────────────────────────────────────────────────────

export const TRACKING_CHECKPOINT_QUEUE = 'tracking-checkpoint';
export const CHECKPOINT_JOB = 'checkpoint';

/** ON only when TRACKING_HOT_STORE=redis. Read once at import (mirrors the watchdog). */
export const TRACKING_HOT_STORE_ENABLED =
  process.env.TRACKING_HOT_STORE === 'redis';

/**
 * How often the worker drains the hot-store dirty set into Postgres.
 *
 * LOAD-BEARING SAFETY INVARIANT: this MUST stay well below WATCHDOG_SILENCE_MS. A LIVE
 * delivery's `tracking.updatedAt` only advances when the checkpoint upserts its row, and
 * the stuck-delivery watchdog reaps a LIVE delivery whose `updatedAt` is older than
 * WATCHDOG_SILENCE_MS. If checkpoints lagged past that window, healthy live drones would
 * be false-reaped (and refunded). `assertCheckpointSafe()` enforces the margin at boot.
 */
export const CHECKPOINT_INTERVAL_MS =
  Number(process.env.CHECKPOINT_INTERVAL_MS) || 30_000;

/** Kill-switch for the checkpoint scan (mirrors WATCHDOG_ENABLED). */
export const CHECKPOINT_ENABLED = process.env.CHECKPOINT_ENABLED !== 'false';

/** Per-tick drain bound so a checkpoint tick stays cheap (mirrors WATCHDOG_BATCH). */
export const CHECKPOINT_BATCH = Number(process.env.CHECKPOINT_BATCH) || 500;

/** Hot key TTL (s): a delivery that stops emitting lets its hot key expire — the last
 * checkpointed Postgres row remains the source of truth. NaN-safe. */
export const HOT_POS_TTL_S = Number(process.env.TRACKING_HOT_TTL_S) || 1_800;

/** Redis keys. The hot position is one hash per delivery; the dirty set names the
 * deliveries needing a flush. */
export const hotPosKey = (deliveryId: string) => `delivery:${deliveryId}:pos`;
export const HOT_DIRTY_SET = 'tracking:dirty';

/** The factor by which CHECKPOINT_INTERVAL_MS must clear WATCHDOG_SILENCE_MS. */
export const CHECKPOINT_SAFETY_FACTOR = 4;

/**
 * Fails LOUD at boot if the checkpoint cadence isn't safely under the watchdog's
 * silence window — a misconfiguration that would arm the watchdog to false-reap live
 * drones (the single sharpest failure mode of the hot-store). Only enforced when the
 * hot-store is enabled (OFF → updateTracking writes through synchronously, so
 * `updatedAt` advances on every frame and the watchdog is unaffected).
 */
export function assertCheckpointSafe(): void {
  if (!TRACKING_HOT_STORE_ENABLED) return;
  if (
    CHECKPOINT_INTERVAL_MS * CHECKPOINT_SAFETY_FACTOR >=
    WATCHDOG_SILENCE_MS
  ) {
    throw new Error(
      `Unsafe tracking hot-store config: CHECKPOINT_INTERVAL_MS=${CHECKPOINT_INTERVAL_MS}ms ` +
        `must be < WATCHDOG_SILENCE_MS=${WATCHDOG_SILENCE_MS}ms / ${CHECKPOINT_SAFETY_FACTOR} ` +
        `(checkpoint lag past the silence window would false-reap live drones).`,
    );
  }
}
