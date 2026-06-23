import { IS_WORKER_TIER } from '../common/process-role';

// ── Transactional outbox (SCALING-1M.md §2, Phase-3 DB-write-shard unblock). A side
// effect that today co-commits with the delivery in one $transaction is instead written
// as an OutboxEvent row INSIDE that same tx (atomic, on the delivery's shard); a
// worker-tier dispatcher then applies it to the user's shard asynchronously + idempotently.
// Stage-1 carries ONLY the referral reward (a pure credit — no failure mode). ─────────────

export const OUTBOX_QUEUE = 'outbox-dispatch';
export const OUTBOX_DISPATCH_JOB = 'dispatch';

/** Event types the dispatcher routes to a handler (Stage-1: referral reward only). */
export const OUTBOX_EVENT_REFERRAL_REWARD = 'REFERRAL_REWARD';

/** Only worker-tier nodes run the dispatcher (api/realtime must not register it). */
export const RUN_OUTBOX_DISPATCHER = IS_WORKER_TIER;

/**
 * PRODUCER flag: route the referral reward through the outbox instead of the inline
 * in-tx grant. Default OFF = today's synchronous PENDING→REWARDED grant, byte-identical.
 * The enqueue stays gated on the same `if (pendingReferral)` pre-check as the inline
 * path, so observable behavior is unchanged (the dispatcher's CAS remains authoritative).
 */
export const OUTBOX_REFERRAL_ENABLED =
  process.env.DELIVERY_OUTBOX_REFERRAL === 'true';

/** CONSUMER kill-switch for the dispatcher scan (mirrors WATCHDOG_ENABLED). Default ON
 * so the consumer is already draining when the producer flag is flipped on. */
export const OUTBOX_DISPATCH_ENABLED =
  process.env.OUTBOX_DISPATCH_ENABLED !== 'false';

/** How often the worker dispatches pending outbox events. */
export const OUTBOX_DISPATCH_INTERVAL_MS =
  Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS) || 5_000;

/** Per-tick claim bound so a tick stays cheap (mirrors CHECKPOINT_BATCH). */
export const OUTBOX_BATCH = Number(process.env.OUTBOX_BATCH) || 100;

/** Max claim attempts in a fast-retry burst before a row is parked FAILED (the lease reaper
 * re-PENDs an abandoned PROCESSING claim up to this many times). FAILED is NOT terminal —
 * every handler is idempotent, so requeueRecoverableFailed() replays a FAILED row
 * (FAILED→PENDING) after a backoff, up to OUTBOX_MAX_RECOVERY_ATTEMPTS total attempts. */
export const OUTBOX_MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 5;

/**
 * Visibility timeout: a PROCESSING claim older than this is treated as abandoned (a
 * crashed/redeployed worker) and reaped back to PENDING by the next tick. MUST exceed
 * the worst-case handler time; it also doubles as the retry backoff between attempts.
 */
export const OUTBOX_CLAIM_LEASE_MS =
  Number(process.env.OUTBOX_CLAIM_LEASE_MS) || 60_000;

/**
 * Backoff before a FAILED row is replayed (re-PENDed). Long (default 30 min) so a transient
 * failure has cleared and we never hot-loop a slow-failing event; gated on the row's last
 * attempt time (claimedAt), so a just-failed row waits the full backoff.
 */
export const OUTBOX_RECOVERY_BACKOFF_MS =
  Number(process.env.OUTBOX_RECOVERY_BACKOFF_MS) || 30 * 60_000;

/**
 * Hard ceiling on TOTAL claim attempts (the fast-retry burst + every recovery replay). Once a
 * row's attempts reach this it stays FAILED permanently — a genuinely poison event (bad
 * payload / missing handler) can't replay forever; the outboxFailed gauge alerts an operator.
 * MUST exceed OUTBOX_MAX_ATTEMPTS for recovery to do anything.
 */
export const OUTBOX_MAX_RECOVERY_ATTEMPTS =
  Number(process.env.OUTBOX_MAX_RECOVERY_ATTEMPTS) || 50;
