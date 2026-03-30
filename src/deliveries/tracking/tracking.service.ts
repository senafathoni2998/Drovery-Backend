import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async getTracking(deliveryId: string) {
    const tracking = await this.prisma.deliveryTracking.findUnique({
      where: { deliveryId },
    });

    if (!tracking) {
      throw new NotFoundException(
        `Tracking data for delivery "${deliveryId}" not found`,
      );
    }

    return tracking;
  }

  async updateTracking(
    deliveryId: string,
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
