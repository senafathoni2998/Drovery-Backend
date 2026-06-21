import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../../config/redis';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CHECKPOINT_BATCH,
  HOT_DIRTY_SET,
  HOT_POS_TTL_S,
  TRACKING_HOT_STORE_ENABLED,
  hotPosKey,
} from './tracking-hot-store.constants';

/** The mutable position scalar TrackingService writes (a subset of DeliveryTracking). */
export interface TrackingPosition {
  droneLat?: number;
  droneLng?: number;
  droneStatus?: string;
  eta?: Date;
}

/**
 * Redis hot-store for the high-frequency drone position (SCALING-1M.md §3). The
 * PRODUCER side (`writePosition`) replaces the per-tick Postgres upsert with a Redis
 * HSET + a "dirty" marker; the worker-tier checkpoint scan calls `drainCheckpoints`
 * to flush the latest position of each dirty delivery to Postgres in one batched
 * upsert per interval (advancing `tracking.updatedAt`, which the watchdog reads).
 * The READ side (`readPosition`) lets `getTracking` overlay the freshest position
 * onto the (possibly slightly-stale) checkpointed row.
 *
 * Inert unless TRACKING_HOT_STORE=redis — when OFF it opens no connection and none of
 * its methods are called (TrackingService gates on `enabled`).
 */
@Injectable()
export class TrackingHotStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingHotStore.name);
  private client?: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return TRACKING_HOT_STORE_ENABLED;
  }

  onModuleInit(): void {
    if (!this.enabled) return; // OFF → no Redis connection
    this.client = new Redis({
      ...buildRedisOptions(this.config, 'cache'),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) =>
      this.logger.warn(`tracking hot-store redis error: ${e.message}`),
    );
  }

  /**
   * Records the latest position to the per-delivery hot key + marks the delivery
   * dirty. Best-effort (never throws) — like the publisher, a Redis blip must not
   * fail the simulation/telemetry write; polling + the next frame self-heal.
   */
  async writePosition(
    deliveryId: string,
    deliveryCreatedAt: Date,
    pos: TrackingPosition,
  ): Promise<void> {
    if (!this.client) return;
    try {
      // Only the present fields are written (an undefined field must not overwrite a
      // prior good value with "" — mirrors the upsert's `undefined = leave alone`).
      const fields: Record<string, string> = {
        // Needed for the composite-key upsert at checkpoint time (deliveries is
        // RANGE(createdAt)-partitioned, so the child FK is (deliveryId, createdAt)).
        deliveryCreatedAt: deliveryCreatedAt.toISOString(),
      };
      if (pos.droneLat !== undefined) fields.droneLat = String(pos.droneLat);
      if (pos.droneLng !== undefined) fields.droneLng = String(pos.droneLng);
      if (pos.droneStatus !== undefined) fields.droneStatus = pos.droneStatus;
      if (pos.eta !== undefined) fields.eta = pos.eta.toISOString();

      await this.client
        .multi()
        .hset(hotPosKey(deliveryId), fields)
        .expire(hotPosKey(deliveryId), HOT_POS_TTL_S)
        .sadd(HOT_DIRTY_SET, deliveryId)
        .exec();
    } catch (e) {
      this.logger.warn(
        `hot-store write failed for ${deliveryId}: ${(e as Error).message}`,
      );
    }
  }

  /** Reads the latest hot position, or null if none (key absent/expired/Redis down). */
  async readPosition(deliveryId: string): Promise<TrackingPosition | null> {
    if (!this.client) return null;
    try {
      const h = await this.client.hgetall(hotPosKey(deliveryId));
      if (!h || Object.keys(h).length === 0) return null;
      return this.parsePosition(h);
    } catch (e) {
      this.logger.warn(
        `hot-store read failed for ${deliveryId}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Worker-tier checkpoint flush: atomically claims a batch of dirty deliveries
   * (SPOP — so across worker replicas each delivery is flushed by exactly one), then
   * upserts each one's latest hot position into Postgres, advancing `updatedAt`. A
   * per-delivery failure re-marks it dirty so the next tick retries (bounded by the
   * hot key's TTL). Returns the number of rows checkpointed.
   */
  async drainCheckpoints(): Promise<number> {
    if (!this.client) return 0;
    const ids = await this.client.spop(HOT_DIRTY_SET, CHECKPOINT_BATCH);
    if (!ids || ids.length === 0) return 0;

    let written = 0;
    for (const deliveryId of ids) {
      try {
        const h = await this.client.hgetall(hotPosKey(deliveryId));
        // Expired/popped-then-gone → nothing to flush.
        if (!h || !h.deliveryCreatedAt) continue;

        const pos = this.parsePosition(h);
        await this.prisma.deliveryTracking.upsert({
          where: { deliveryId },
          create: {
            deliveryId,
            deliveryCreatedAt: new Date(h.deliveryCreatedAt),
            ...pos,
          },
          // An all-undefined `pos` still advances @updatedAt (the watchdog liveness
          // signal) — the same property updateTracking({}) relies on.
          update: { ...pos },
        });
        written++;
      } catch (e) {
        // Re-mark dirty so we retry on the next tick rather than silently dropping
        // the checkpoint (which would stall this delivery's updatedAt).
        await this.client
          .sadd(HOT_DIRTY_SET, deliveryId)
          .catch(() => undefined);
        this.logger.warn(
          `checkpoint upsert failed for ${deliveryId}: ${(e as Error).message}`,
        );
      }
    }
    if (written > 0) {
      this.logger.debug(`checkpointed ${written} tracking row(s)`);
    }
    return written;
  }

  private parsePosition(h: Record<string, string>): TrackingPosition {
    const num = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const eta = h.eta ? new Date(h.eta) : undefined;
    return {
      droneLat: num(h.droneLat),
      droneLng: num(h.droneLng),
      droneStatus: h.droneStatus,
      eta: eta && !Number.isNaN(eta.getTime()) ? eta : undefined,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
