import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../../config/redis';

/** Shape published to Redis on every position/status change (matches the
 * fields the worker computed before — no contract change for clients). */
export interface TrackingUpdatePayload {
  deliveryId: string;
  status?: string;
  droneStatus?: string;
  droneLat?: number;
  droneLng?: number;
}

/** Single source of truth for the per-delivery channel name. Imported by both
 * the publisher (worker) and the subscriber (API) so the string never drifts. */
export const trackingChannel = (deliveryId: string) =>
  `delivery:${deliveryId}:update`;

/**
 * Publishes tracking updates to Redis. Lives in the WORKER (where the simulation
 * runs) — the worker has no WS server, so it can't deliver to clients directly.
 * Every API instance's TrackingSubscriber receives the message and fans it out
 * to its locally-connected WS clients. Fail-open: a publish error never breaks
 * the delivery simulation (polling remains authoritative).
 */
@Injectable()
export class TrackingPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingPublisher.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      ...buildRedisOptions(this.config),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) =>
      this.logger.warn(`tracking publisher redis error: ${e.message}`),
    );
  }

  async publishUpdate(payload: TrackingUpdatePayload): Promise<void> {
    try {
      await this.client.publish(
        trackingChannel(payload.deliveryId),
        JSON.stringify(payload),
      );
    } catch (e) {
      this.logger.warn(`publish failed: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }
}
