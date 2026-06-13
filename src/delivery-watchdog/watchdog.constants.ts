import { DeliveryStatus } from '@prisma/client';

export const WATCHDOG_QUEUE = 'delivery-watchdog';
export const REAP_JOB = 'reap';

// Kill-switch: ON by default (a self-healing system should reap stranded
// deliveries) — set WATCHDOG_ENABLED=false to pause the reaper (e.g. during a known
// platform-wide telemetry outage). Read once at import time, so toggling it requires
// a worker redeploy/restart; on the disabled boot the scheduler is actively torn
// down (see WatchdogScheduler), and widening WATCHDOG_SILENCE_MS is the no-teardown
// lever to ride out a degraded-telemetry period.
export const WATCHDOG_ENABLED = process.env.WATCHDOG_ENABLED !== 'false';

// How often the reaper scans (mirrors the recurring scan interval).
export const WATCHDOG_SCAN_INTERVAL_MS =
  Number(process.env.WATCHDOG_SCAN_INTERVAL_MS) || 60_000;

// A LIVE in-flight delivery whose LAST telemetry is older than this is considered
// stuck/silent (the drone lost comms, or a return flight died). THE critical safety
// knob: generous (10 min ≫ the ~5s position cadence) so a brief blip never reaps a
// healthy delivery. Every numeric env is `Number(env) || default` so a malformed
// value can never become NaN (which would make the date predicate always-true).
export const WATCHDOG_SILENCE_MS =
  Number(process.env.WATCHDOG_SILENCE_MS) || 10 * 60_000;

// Never reap a delivery younger than this — guards a brand-new in-flight delivery
// that hasn't produced a tracking row yet (defense-in-depth alongside the silence
// window). Defaults to the silence timeout.
export const WATCHDOG_MIN_AGE_MS =
  Number(process.env.WATCHDOG_MIN_AGE_MS) || WATCHDOG_SILENCE_MS;

// Per-tick bound so a backlog scan stays cheap (mirrors the recurring SCAN_BATCH).
export const WATCHDOG_BATCH = 200;

/**
 * The in-motion statuses a stuck-delivery reap may fire from — a watchdog-LOCAL
 * strict subset, NOT FAILABLE_STATUSES. Crucially excludes AWAITING_HANDOFF: an
 * arrived delivery waiting for the recipient OTP has NO time bound and must never
 * be reaped. (Explicit literal, not a filter of FAILABLE_STATUSES, so a future
 * FAILABLE addition that is also a no-time-bound wait isn't auto-included.)
 */
export const WATCHDOG_STUCK_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DRONE_ASSIGNED,
  DeliveryStatus.PICKUP_IN_PROGRESS,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.RETURNING,
];
