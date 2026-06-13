import { DeliveryStatus } from '@prisma/client';

export const SIM_QUEUE = 'delivery-simulation';

// Worker concurrency (jobs processed in parallel). Tune against the DB pool.
export const SIM_WORKER_CONCURRENCY = parseInt(
  process.env.SIM_WORKER_CONCURRENCY ?? '10',
  10,
);

// Lifecycle order (incl. PENDING) — used for monotonic, forward-only status
// transitions so a late/retried/stalled job can't regress or resurrect a delivery.
export const STATUS_ORDER: DeliveryStatus[] = [
  DeliveryStatus.PENDING,
  DeliveryStatus.CONFIRMED,
  DeliveryStatus.DRONE_ASSIGNED,
  DeliveryStatus.PICKUP_IN_PROGRESS,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.AWAITING_HANDOFF,
  DeliveryStatus.DELIVERED,
];

/** Statuses strictly before `target` — the only states from which it may advance. */
export function statusesBefore(target: DeliveryStatus): DeliveryStatus[] {
  const i = STATUS_ORDER.indexOf(target);
  return i <= 0 ? [] : STATUS_ORDER.slice(0, i);
}

export interface DeliveryCoords {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

// Default coordinates (Bandung area — matches frontend mock data)
export const DEFAULT_COORDS: DeliveryCoords = {
  fromLat: -6.903,
  fromLng: 107.615,
  toLat: -6.922,
  toLng: 107.607,
};

// Drone position update interval during movement phases
export const POSITION_UPDATE_MS = 5_000;

export interface SimStage {
  status: DeliveryStatus;
  delayMs: number;
}

// Each simulation stage: when it fires + which status it sets. The user-facing
// title/body and the drone-status map label are localized by I18nService keyed on
// the status — `notification.stage.<status>.{title,body,droneStatus}` (the single
// source of those strings now lives in src/i18n/catalog).
export const STAGES: SimStage[] = [
  { status: DeliveryStatus.CONFIRMED, delayMs: 10_000 },
  { status: DeliveryStatus.DRONE_ASSIGNED, delayMs: 25_000 },
  { status: DeliveryStatus.PICKUP_IN_PROGRESS, delayMs: 45_000 },
  { status: DeliveryStatus.IN_TRANSIT, delayMs: 70_000 },
  // Terminal AUTO stage: the drone arrives and waits. The final transition to
  // DELIVERED (+ proof) happens only when the recipient confirms the handoff
  // OTP via POST /deliveries/:id/confirm-handoff — the sim never auto-delivers.
  { status: DeliveryStatus.AWAITING_HANDOFF, delayMs: 120_000 },
];

// ── Job payloads ────────────────────────────────────────────
export const STAGE_JOB = 'stage';
export const POSITION_JOB = 'position';
// Deferred lifecycle start for a SCHEDULED delivery — fires at the pickup window,
// flips SCHEDULED → PENDING, then enqueues the normal stage/position jobs.
export const KICKOFF_JOB = 'kickoff';

// `_carrier` (optional) holds the injected W3C trace context so the worker can
// continue the enqueueing request's trace; absent unless tracing is enabled.
type TraceCarrier = { _carrier?: Record<string, string> };

export interface KickoffJobData extends TraceCarrier {
  deliveryId: string;
  userId: string;
  coords: DeliveryCoords;
}

export interface StageJobData extends TraceCarrier {
  deliveryId: string;
  userId: string;
  coords: DeliveryCoords;
  stageIndex: number;
}

export interface PositionJobData extends TraceCarrier {
  deliveryId: string;
  lat: number;
  lng: number;
}

export function resolveCoords(coords?: Partial<DeliveryCoords>): DeliveryCoords {
  return {
    fromLat: coords?.fromLat ?? DEFAULT_COORDS.fromLat,
    fromLng: coords?.fromLng ?? DEFAULT_COORDS.fromLng,
    toLat: coords?.toLat ?? DEFAULT_COORDS.toLat,
    toLng: coords?.toLng ?? DEFAULT_COORDS.toLng,
  };
}

export function dronePositionForStage(
  status: DeliveryStatus,
  coords: DeliveryCoords,
): { lat: number; lng: number } | undefined {
  switch (status) {
    case DeliveryStatus.DRONE_ASSIGNED:
      return { lat: coords.fromLat + 0.005, lng: coords.fromLng + 0.005 };
    case DeliveryStatus.PICKUP_IN_PROGRESS:
      return { lat: coords.fromLat, lng: coords.fromLng };
    case DeliveryStatus.IN_TRANSIT:
      return { lat: coords.fromLat, lng: coords.fromLng };
    case DeliveryStatus.AWAITING_HANDOFF:
      return { lat: coords.toLat, lng: coords.toLng };
    case DeliveryStatus.DELIVERED:
      return { lat: coords.toLat, lng: coords.toLng };
    default:
      return undefined;
  }
}

/**
 * Computes the interpolated drone-position ticks (delay + lat/lng) for the two
 * movement windows. The COUNT is independent of coordinates (it depends only on
 * the time windows), so it's stable for job-id generation/removal.
 */
export function buildPositionTicks(
  coords: DeliveryCoords,
): { delay: number; lat: number; lng: number }[] {
  const windows = [
    {
      startMs: 25_000,
      endMs: 45_000,
      from: { lat: coords.fromLat + 0.005, lng: coords.fromLng + 0.005 },
      to: { lat: coords.fromLat, lng: coords.fromLng },
    },
    {
      startMs: 70_000,
      endMs: 120_000,
      from: { lat: coords.fromLat, lng: coords.fromLng },
      to: { lat: coords.toLat, lng: coords.toLng },
    },
  ];

  const ticks: { delay: number; lat: number; lng: number }[] = [];
  for (const w of windows) {
    const steps = Math.floor((w.endMs - w.startMs) / POSITION_UPDATE_MS);
    for (let i = 1; i < steps; i++) {
      const progress = i / steps;
      ticks.push({
        delay: w.startMs + i * POSITION_UPDATE_MS,
        lat: w.from.lat + (w.to.lat - w.from.lat) * progress,
        lng: w.from.lng + (w.to.lng - w.from.lng) * progress,
      });
    }
  }
  return ticks;
}

// Stable count of position ticks (coords-independent) — used to remove jobs on cancel.
export const POSITION_TICK_COUNT = buildPositionTicks(DEFAULT_COORDS).length;
