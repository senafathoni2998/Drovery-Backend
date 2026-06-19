import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async getTracking(deliveryId: string) {
    // A tracking poll — lag-tolerant → read replica (falls back to primary).
    const tracking = await this.prisma.readWithFallback((c) =>
      c.deliveryTracking.findUnique({
        where: { deliveryId },
      }),
    );

    if (!tracking) {
      throw new NotFoundException(
        `Tracking data for delivery "${deliveryId}" not found`,
      );
    }

    return tracking;
  }

  /**
   * Upserts the latest drone position/status snapshot. NOTE: `droneStatus` is a
   * human label persisted ALREADY-LOCALIZED to the delivery owner's locale at the
   * time of the event (a point-in-time snapshot, like the persisted notification
   * rows + the support auto-ack) — it is NOT re-translated on read, so if the
   * owner switches locale mid-delivery the label stays in the prior language until
   * the next event writes it. The discrete `status` enum on the Delivery row is the
   * locale-independent source of truth a client can map to its own label.
   */
  async updateTracking(
    deliveryId: string,
    deliveryCreatedAt: Date,
    data: {
      droneLat?: number;
      droneLng?: number;
      droneStatus?: string;
      eta?: Date;
    },
  ) {
    return this.prisma.deliveryTracking.upsert({
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
}
