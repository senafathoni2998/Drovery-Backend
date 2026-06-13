export const RECUR_QUEUE = 'recurring-materialize';
export const MATERIALIZE_JOB = 'materialize';

// The scan fires every minute. Timing precision comes from the per-instance
// kickoff (the materialized delivery is SCHEDULED), so the scan only needs to
// run often enough to materialize an occurrence before its pickup window.
export const SCAN_INTERVAL_MS = 60_000;

// Materialize occurrences up to this far ahead (>> SCAN_INTERVAL so a tick can
// never skip past one; << MAX_SCHEDULE_DAYS so create() never rejects the pickup
// as too-far-ahead). Bounds how early a Stripe intent is pre-created.
export const LOOKAHEAD_MS = 6 * 60 * 60 * 1000; // 6h

// An occurrence older than this (worker was down) is skipped, not backfilled.
// Sized above the scan interval so a barely-late occurrence still fires once.
export const MISSED_GRACE_MS = 2 * SCAN_INTERVAL_MS; // 120s

// Per-tick bounds so a huge schedule count or a far-past cursor can't stall the worker.
export const SCAN_BATCH = 200;
export const MAX_CURSOR_ADVANCES = 400;

export interface MaterializeJobData {
  // The repeatable scan carries no payload; it discovers due schedules itself.
  _?: never;
}
