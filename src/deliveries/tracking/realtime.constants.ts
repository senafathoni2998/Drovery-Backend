// ── Realtime fan-out tuning (SCALING-1M.md §4). Both default to OFF/inert, so unset
// env = today's behaviour, byte-identical. ─────────────────────────────────────────

/**
 * Position-push COALESCING rate (Hz). When > 0, position-only tracking frames are
 * buffered and only the LATEST per delivery is published at this rate — so a fast LIVE
 * drone (e.g. 10 Hz) can't multiply the fan-out-bus + per-socket load. A frame carrying
 * a STATUS transition is NEVER coalesced (it publishes immediately). 0 (default) =
 * pass-through, no buffering. NaN-safe.
 */
export const POSITION_PUSH_HZ = Number(process.env.POSITION_PUSH_HZ) || 0;

/**
 * Per-socket backpressure watermark (bytes). A tracking frame is DROPPED for a socket
 * whose send buffer already exceeds this — a slow/stalled client must not let its buffer
 * grow unbounded and balloon node memory (the position stream is lossy by nature; the
 * next frame supersedes a dropped one). Default 1 MiB. NaN-safe.
 */
export const WS_MAX_BUFFERED_BYTES =
  Number(process.env.WS_MAX_BUFFERED_BYTES) || 1024 * 1024;
