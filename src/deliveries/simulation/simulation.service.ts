import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingGateway } from '../tracking/tracking.gateway';

interface DeliveryCoords {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

// Default coordinates (Bandung area — matches frontend mock data)
const DEFAULT_COORDS: DeliveryCoords = {
  fromLat: -6.903,
  fromLng: 107.615,
  toLat: -6.922,
  toLng: 107.607,
};

// Drone position update interval during movement phases
const POSITION_UPDATE_MS = 5_000;

// Each simulation stage: when it fires, what status it sets, and what it tells the user
const STAGES: {
  status: DeliveryStatus;
  delayMs: number;
  droneStatus: string;
  title: string;
  body: string;
}[] = [
  {
    status: DeliveryStatus.CONFIRMED,
    delayMs: 10_000, // 10 s after creation
    droneStatus: 'Delivery confirmed',
    title: 'Delivery Confirmed',
    body: 'Your delivery has been confirmed and is being processed.',
  },
  {
    status: DeliveryStatus.DRONE_ASSIGNED,
    delayMs: 25_000, // 25 s
    droneStatus: 'Drone assigned',
    title: 'Drone Assigned',
    body: 'A drone has been assigned to your delivery.',
  },
  {
    status: DeliveryStatus.PICKUP_IN_PROGRESS,
    delayMs: 45_000, // 45 s
    droneStatus: 'On the way to Pickup Location',
    title: 'Pickup In Progress',
    body: 'The drone is heading to the pickup location.',
  },
  {
    status: DeliveryStatus.IN_TRANSIT,
    delayMs: 70_000, // 1 min 10 s
    droneStatus: 'En route to destination',
    title: 'Package In Transit',
    body: 'Your package has been picked up and is on its way!',
  },
  {
    status: DeliveryStatus.DELIVERED,
    delayMs: 120_000, // 2 min
    droneStatus: 'Delivered',
    title: 'Package Delivered',
    body: 'Your package has been delivered successfully!',
  },
];

@Injectable()
export class SimulationService implements OnModuleDestroy {
  private readonly logger = new Logger(SimulationService.name);
  private readonly activeTimers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
    private readonly trackingGateway: TrackingGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Public API ────────────────────────────────────────────

  startSimulation(
    deliveryId: string,
    userId: string,
    coords?: Partial<DeliveryCoords>,
  ) {
    const c: DeliveryCoords = {
      fromLat: coords?.fromLat ?? DEFAULT_COORDS.fromLat,
      fromLng: coords?.fromLng ?? DEFAULT_COORDS.fromLng,
      toLat: coords?.toLat ?? DEFAULT_COORDS.toLat,
      toLng: coords?.toLng ?? DEFAULT_COORDS.toLng,
    };

    this.logger.log(`Starting delivery simulation: ${deliveryId}`);

    const timers: NodeJS.Timeout[] = [];

    // 1. Schedule every status transition
    for (const stage of STAGES) {
      timers.push(
        setTimeout(() => this.transitionTo(deliveryId, userId, stage, c), stage.delayMs),
      );
    }

    // 2. Schedule drone position updates between movement phases
    //    DRONE_ASSIGNED → PICKUP_IN_PROGRESS  (drone base → pickup)
    this.schedulePositionUpdates(timers, deliveryId, 25_000, 45_000, {
      from: { lat: c.fromLat + 0.005, lng: c.fromLng + 0.005 },
      to: { lat: c.fromLat, lng: c.fromLng },
    });
    //    IN_TRANSIT → DELIVERED  (pickup → dropoff)
    this.schedulePositionUpdates(timers, deliveryId, 70_000, 120_000, {
      from: { lat: c.fromLat, lng: c.fromLng },
      to: { lat: c.toLat, lng: c.toLng },
    });

    this.activeTimers.set(deliveryId, timers);
  }

  stopSimulation(deliveryId: string) {
    const timers = this.activeTimers.get(deliveryId);
    if (!timers) return;
    timers.forEach(clearTimeout);
    this.activeTimers.delete(deliveryId);
    this.logger.log(`Stopped simulation: ${deliveryId}`);
  }

  onModuleDestroy() {
    for (const deliveryId of this.activeTimers.keys()) {
      this.stopSimulation(deliveryId);
    }
  }

  // ── Internals ─────────────────────────────────────────────

  private async transitionTo(
    deliveryId: string,
    userId: string,
    stage: (typeof STAGES)[number],
    coords: DeliveryCoords,
  ) {
    try {
      // Guard: abort if delivery was canceled or deleted
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: deliveryId },
      });
      if (!delivery || delivery.status === DeliveryStatus.CANCELED) {
        this.stopSimulation(deliveryId);
        return;
      }

      // Update delivery status
      await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: { status: stage.status },
      });

      // Resolve drone position for this stage
      const dronePos = this.dronePositionForStage(stage.status, coords);

      // Upsert tracking record
      await this.trackingService.updateTracking(deliveryId, {
        droneLat: dronePos?.lat,
        droneLng: dronePos?.lng,
        droneStatus: stage.droneStatus,
        eta:
          stage.status === DeliveryStatus.DELIVERED
            ? undefined
            : new Date(Date.now() + 60_000),
      });

      // Create user notification
      await this.notificationsService.create(userId, stage.title, stage.body, {
        deliveryId,
        status: stage.status,
      });

      // Broadcast to any WebSocket subscribers
      this.trackingGateway.broadcastTrackingUpdate(deliveryId, {
        deliveryId,
        status: stage.status,
        droneStatus: stage.droneStatus,
        droneLat: dronePos?.lat,
        droneLng: dronePos?.lng,
      });

      this.logger.log(`Delivery ${deliveryId} → ${stage.status}`);

      // Cleanup on final stage
      if (stage.status === DeliveryStatus.DELIVERED) {
        this.activeTimers.delete(deliveryId);
      }
    } catch (error) {
      this.logger.error(
        `Simulation error [${deliveryId}]: ${(error as Error).message}`,
      );
    }
  }

  private dronePositionForStage(
    status: DeliveryStatus,
    coords: DeliveryCoords,
  ): { lat: number; lng: number } | undefined {
    switch (status) {
      case DeliveryStatus.DRONE_ASSIGNED:
        // Drone starts at a "base" near the pickup
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
   * Linearly interpolates drone position between two points
   * and emits a tracking update every POSITION_UPDATE_MS.
   */
  private schedulePositionUpdates(
    timers: NodeJS.Timeout[],
    deliveryId: string,
    startMs: number,
    endMs: number,
    route: { from: { lat: number; lng: number }; to: { lat: number; lng: number } },
  ) {
    const duration = endMs - startMs;
    const steps = Math.floor(duration / POSITION_UPDATE_MS);

    for (let i = 1; i < steps; i++) {
      const progress = i / steps;
      const lat = route.from.lat + (route.to.lat - route.from.lat) * progress;
      const lng = route.from.lng + (route.to.lng - route.from.lng) * progress;
      const delay = startMs + i * POSITION_UPDATE_MS;

      timers.push(
        setTimeout(async () => {
          try {
            await this.trackingService.updateTracking(deliveryId, {
              droneLat: lat,
              droneLng: lng,
            });
            this.trackingGateway.broadcastTrackingUpdate(deliveryId, {
              deliveryId,
              droneLat: lat,
              droneLng: lng,
            });
          } catch {
            // Position updates are best-effort; errors are non-fatal
          }
        }, delay),
      );
    }
  }
}
