import { IS_WORKER_TIER } from '../../common/process-role';

// ── Orphaned-reservation janitor (SCALING-1M.md §2 Stage-A3). The debit-first saga (A2)
// commits the wallet-debit + promo-redeem as authoritative reservations in their OWN txns
// BEFORE the delivery is created. In-process failures are compensated synchronously, but a
// PROCESS CRASH between the reservation commit and the delivery create leaves the credits
// withheld / promo counted with no delivery and no charge — credits stranded. This sweep is
// the out-of-process safety net: it finds reservations older than a grace window whose
// delivery never materialized and reverses them with the same idempotent compensations
// (refundForDelivery / releaseForDelivery). Worker-tier only. ────────────────────────────

export const ORPHAN_REAPER_QUEUE = 'orphan-reservation-reaper';
export const ORPHAN_REAPER_SWEEP_JOB = 'sweep';

/**
 * Active ONLY when the saga it protects is enabled (DELIVERY_DEBIT_FIRST=true) — orphaned
 * reservations of this kind can't exist otherwise (the flag-off path co-commits the debit
 * with the delivery atomically). So with the flag off the reaper does not even schedule:
 * zero new DB load by default. Worker-tier only. ORPHAN_REAPER_ENABLED=false is a kill switch.
 * (Operationally: drain pending reservations before turning DELIVERY_DEBIT_FIRST back off.)
 */
export const RUN_ORPHAN_REAPER =
  IS_WORKER_TIER &&
  process.env.DELIVERY_DEBIT_FIRST === 'true' &&
  process.env.ORPHAN_REAPER_ENABLED !== 'false';

export const ORPHAN_REAPER_SWEEP_INTERVAL_MS =
  Number(process.env.ORPHAN_REAPER_INTERVAL_MS) || 60_000;

/**
 * GRACE WINDOW — a reservation younger than this is NEVER compensated (its delivery tx may
 * simply be slow / mid-retry). LOAD-BEARING money knob: it MUST exceed the worst-case
 * delivery-tx commit latency including the full MAX_TRACKING_ID_TRIES retry loop, or the
 * sweep would refund a reservation whose delivery is about to commit → the platform
 * under-charges. Default 10 min is generously above the few-seconds real worst case.
 */
export const ORPHAN_GRACE_MS = Number(process.env.ORPHAN_GRACE_MS) || 600_000;

/**
 * Sliding-window floor: only scan reservations that aged past the grace window within the
 * last LOOKBACK (so the scan cost is bounded by recent volume, not all history). An orphan
 * is caught in the [grace, grace+lookback] window after its reservation; if the worker is
 * down longer than LOOKBACK an orphan can escape the automated sweep (recoverable manually —
 * the lastScan gauge alerts on a stalled sweep). Default 24h.
 */
export const ORPHAN_LOOKBACK_MS =
  Number(process.env.ORPHAN_LOOKBACK_MS) || 86_400_000;

/** Per-sweep candidate bound (mirrors WATCHDOG_BATCH / CHECKPOINT_BATCH). */
export const ORPHAN_BATCH = Number(process.env.ORPHAN_BATCH) || 500;
