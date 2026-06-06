import { DeliveryStatus } from '@prisma/client';

export const SIM_QUEUE = 'delivery-simulation';

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
  droneStatus: string;
  title: string;
  body: string;
}

// Each simulation stage: when it fires, what status it sets, and what it tells the user
export const STAGES: SimStage[] = [
  {
    status: DeliveryStatus.CONFIRMED,
    delayMs: 10_000,
    droneStatus: 'Delivery confirmed',
    title: 'Delivery Confirmed',
    body: 'Your delivery has been confirmed and is being processed.',
  },
  {
    status: DeliveryStatus.DRONE_ASSIGNED,
    delayMs: 25_000,
    droneStatus: 'Drone assigned',
    title: 'Drone Assigned',
    body: 'A drone has been assigned to your delivery.',
  },
  {
    status: DeliveryStatus.PICKUP_IN_PROGRESS,
    delayMs: 45_000,
    droneStatus: 'On the way to Pickup Location',
    title: 'Pickup In Progress',
    body: 'The drone is heading to the pickup location.',
  },
  {
    status: DeliveryStatus.IN_TRANSIT,
    delayMs: 70_000,
    droneStatus: 'En route to destination',
    title: 'Package In Transit',
    body: 'Your package has been picked up and is on its way!',
  },
  {
    status: DeliveryStatus.DELIVERED,
    delayMs: 120_000,
    droneStatus: 'Delivered',
    title: 'Package Delivered',
    body: 'Your package has been delivered successfully!',
  },
];

// ── Job payloads ────────────────────────────────────────────
export const STAGE_JOB = 'stage';
export const POSITION_JOB = 'position';

export interface StageJobData {
  deliveryId: string;
  userId: string;
  coords: DeliveryCoords;
  stageIndex: number;
}

export interface PositionJobData {
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
