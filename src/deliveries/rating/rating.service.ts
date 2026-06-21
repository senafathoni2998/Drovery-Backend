import { Injectable } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

import {
  AppConflictException,
  AppNotFoundException,
} from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { RateDeliveryDto } from './dto/rate-delivery.dto';

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rate a delivered delivery (1–5 stars + optional comment). Owner-scoped;
   * only DELIVERED deliveries can be rated; upserts so a user can revise.
   */
  async rate(userId: string, deliveryId: string, dto: RateDeliveryDto) {
    const delivery = await this.ownDelivery(userId, deliveryId);
    if (delivery.status !== DeliveryStatus.DELIVERED) {
      throw new AppConflictException('error.delivery.rating.not_delivered');
    }

    return this.prisma.deliveryRating.upsert({
      where: { deliveryId },
      create: {
        deliveryId,
        deliveryCreatedAt: delivery.createdAt,
        userId,
        stars: dto.stars,
        comment: dto.comment,
      },
      update: { stars: dto.stars, comment: dto.comment },
    });
  }

  /** The rating for a delivery (404 if the delivery isn't owned or isn't rated). */
  async getRating(userId: string, deliveryId: string) {
    await this.ownDelivery(userId, deliveryId);
    const rating = await this.prisma.deliveryRating.findUnique({
      where: { deliveryId },
    });
    if (!rating) {
      throw new AppNotFoundException('error.delivery.rating.not_rated', {
        id: deliveryId,
      });
    }
    return rating;
  }

  private async ownDelivery(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.userId !== userId) {
      throw new AppNotFoundException('error.delivery.not_found', {
        id: deliveryId,
      });
    }
    return delivery;
  }
}
