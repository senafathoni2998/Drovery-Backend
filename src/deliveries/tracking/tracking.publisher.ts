import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../../config/redis';
import {
  PUBSUB_MODE_STANDARD,
  type PubSubMode,
  pubSubPublish,
  resolvePubSubMode,
} from '../../common/pubsub/pubsub-transport';
import { PositionCoalescer } from './position-coalescer';

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
  // Defaults to 'standard' so unit tests that inject a mock client (skipping
  // onModuleInit) stay byte-identical; onModuleInit reads the real mode from config.
  private mode: PubSubMode = PUBSUB_MODE_STANDARD;
  // Caps the per-delivery publish rate when POSITION_PUSH_HZ>0; inert (pass-through)
  // by default. Position frames flush on its timer; status transitions go immediately.
  private readonly coalescer = new PositionCoalescer(
    (p) => void this.doPublish(p),
  );

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.mode = resolvePubSubMode(this.config);
    this.client = new Redis({
      ...buildRedisOptions(this.config, 'pubsub'),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) =>
      this.logger.warn(`tracking publisher redis error: ${e.message}`),
    );
    this.logger.log(`TrackingPublisher ready (pubsub mode: ${this.mode})`);
  }

  async publishUpdate(payload: TrackingUpdatePayload): Promise<void> {
    // Coalescing ON → route through the rate-limiting buffer (fire-and-forget, as the
    // timer flush can't be awaited). OFF (default) → publish synchronously, awaited,
    // byte-identical to before.
    if (this.coalescer.active) {
      this.coalescer.submit(payload);
      return;
    }
    await this.doPublish(payload);
  }

  private async doPublish(payload: TrackingUpdatePayload): Promise<void> {
    try {
      await pubSubPublish(
        this.client,
        trackingChannel(payload.deliveryId),
        JSON.stringify(payload),
        this.mode,
      );
    } catch (e) {
      this.logger.warn(`publish failed: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.coalescer.stop();
    await this.client?.quit().catch(() => undefined);
  }
}
