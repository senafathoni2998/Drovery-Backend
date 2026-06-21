import { Injectable } from '@nestjs/common';

import { AppNotFoundException } from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingHotStore, TrackingPosition } from './tracking-hot-store';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hotStore: TrackingHotStore,
  ) {}

  async getTracking(deliveryId: string) {
    // A tracking poll — lag-tolerant → read replica (falls back to primary).
    const tracking = await this.prisma.readWithFallback((c) =>
      c.deliveryTracking.findUnique({
        where: { deliveryId },
      }),
    );

    // Hot-store ON: overlay the freshest (not-yet-checkpointed) position so a read
    // reflects the live drone immediately rather than at the checkpoint cadence.
    if (this.hotStore.enabled) {
      const hot = await this.hotStore.readPosition(deliveryId);
      if (hot) {
        return tracking
          ? { ...tracking, ...this.definedOnly(hot) }
          : this.synthesizeRow(deliveryId, hot);
      }
    }

    if (!tracking) {
      throw new AppNotFoundException('error.delivery.tracking.not_found', {
        id: deliveryId,
      });
    }

    return tracking;
  }

  /**
   * Records the latest drone position/status snapshot. NOTE: `droneStatus` is a
   * human label persisted ALREADY-LOCALIZED to the delivery owner's locale at the
   * time of the event (a point-in-time snapshot) — it is NOT re-translated on read.
   * The discrete `status` enum on the Delivery row is the locale-independent source
   * of truth a client maps to its own label; status transitions are written on the
   * Delivery row elsewhere, never here, so the hot-store offload never touches them.
   *
   * Hot-store ON (TRACKING_HOT_STORE=redis): the high-frequency position write goes to
   * Redis (one batched Postgres upsert per checkpoint interval instead of one per
   * tick — SCALING-1M.md §3). Default OFF: the synchronous per-tick upsert, unchanged.
   */
  async updateTracking(
    deliveryId: string,
    deliveryCreatedAt: Date,
    data: TrackingPosition,
  ): Promise<void> {
    if (this.hotStore.enabled) {
      await this.hotStore.writePosition(deliveryId, deliveryCreatedAt, data);
      return;
    }

    await this.prisma.deliveryTracking.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        deliveryCreatedAt,
        droneLat: data.droneLat,
        droneLng: data.droneLng,
        droneStatus: data.droneStatus,
        eta: data.eta,
      },
      update: {
        droneLat: data.droneLat,
        droneLng: data.droneLng,
        droneStatus: data.droneStatus,
        eta: data.eta,
      },
    });
  }

  /** Drop undefined keys so the overlay never clobbers a checkpointed value. */
  private definedOnly(pos: TrackingPosition): Partial<TrackingPosition> {
    const out: Partial<TrackingPosition> = {};
    if (pos.droneLat !== undefined) out.droneLat = pos.droneLat;
    if (pos.droneLng !== undefined) out.droneLng = pos.droneLng;
    if (pos.droneStatus !== undefined) out.droneStatus = pos.droneStatus;
    if (pos.eta !== undefined) out.eta = pos.eta;
    return out;
  }

  /** No checkpoint row yet (first interval of a delivery) but a hot position exists →
   * return a row-shaped object so a read doesn't 404 before the first checkpoint. */
  private synthesizeRow(deliveryId: string, hot: TrackingPosition) {
    return {
      deliveryId,
      droneLat: hot.droneLat ?? null,
      droneLng: hot.droneLng ?? null,
      droneStatus: hot.droneStatus ?? null,
      eta: hot.eta ?? null,
    };
  }
}
