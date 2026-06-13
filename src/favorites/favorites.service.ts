import { Injectable, NotFoundException } from '@nestjs/common';

import { DeliveriesService } from '../deliveries/deliveries.service';
import { nowInServiceTz } from '../deliveries/delivery-schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFavoriteDto, OrderFavoriteDto } from './dto/favorite.dto';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
  ) {}

  /** Snapshot a past delivery (owner-scoped) as a reusable template. */
  async create(userId: string, dto: CreateFavoriteDto) {
    const d = await this.deliveries.findOne(userId, dto.deliveryId); // 404 if not owner
    return this.prisma.favorite.create({
      data: {
        userId,
        label: dto.label,
        fromAddress: d.fromAddress,
        toAddress: d.toAddress,
        fromLat: d.fromLat,
        fromLng: d.fromLng,
        toLat: d.toLat,
        toLng: d.toLng,
        receiver: d.receiver,
        packages: d.packages,
        packageSize: d.packageSize,
        packageWeight: d.packageWeight,
        packageTypes: d.packageTypes,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.favorite.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException(`Favorite "${id}" not found`);
    }
  }

  /** Place a delivery from a saved favorite (reuses create(), so serviceability/
   * pricing/payment run fresh). Immediate unless a pickup override is given. */
  async order(userId: string, id: string, overrides?: OrderFavoriteDto) {
    const fav = await this.prisma.favorite.findFirst({ where: { id, userId } });
    if (!fav) {
      throw new NotFoundException(`Favorite "${id}" not found`);
    }
    const now = nowInServiceTz();
    return this.deliveries.create(userId, {
      fromAddress: fav.fromAddress,
      toAddress: fav.toAddress,
      receiver: fav.receiver,
      packages: fav.packages,
      packageSize: fav.packageSize,
      packageWeight: fav.packageWeight,
      packageTypes: fav.packageTypes,
      fromLat: fav.fromLat ?? undefined,
      fromLng: fav.fromLng ?? undefined,
      toLat: fav.toLat ?? undefined,
      toLng: fav.toLng ?? undefined,
      pickupDate: overrides?.pickupDate ?? now.date,
      pickupTime: overrides?.pickupTime ?? now.time,
    });
  }
}
