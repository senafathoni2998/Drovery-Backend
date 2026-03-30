import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { AddPaymentMethodDto } from './dto';

// TODO: Initialize Stripe client when STRIPE_SECRET_KEY is configured

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findAll(userId: string) {
    return this.prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addPaymentMethod(userId: string, dto: AddPaymentMethodDto) {
    const existingCount = await this.prisma.paymentMethod.count({
      where: { userId },
    });

    const paymentMethod = await this.prisma.paymentMethod.create({
      data: {
        userId,
        stripePaymentMethodId: `manual_${Date.now()}`,
        network: dto.network,
        last4: dto.last4,
        holderName: dto.holderName,
        expiry: dto.expiry,
        isDefault: existingCount === 0,
      },
    });

    this.logger.log(
      `Payment method ${paymentMethod.id} added for user ${userId}`,
    );

    return paymentMethod;
  }

  async remove(userId: string, paymentMethodId: string) {
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });

    if (!method) {
      throw new NotFoundException(
        `Payment method with id "${paymentMethodId}" not found`,
      );
    }

    if (method.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.paymentMethod.delete({
      where: { id: paymentMethodId },
    });

    // If the removed method was the default, promote the most recent remaining card
    if (method.isDefault) {
      const mostRecent = await this.prisma.paymentMethod.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      if (mostRecent) {
        await this.prisma.paymentMethod.update({
          where: { id: mostRecent.id },
          data: { isDefault: true },
        });
      }
    }

    return { success: true };
  }

  async setDefault(userId: string, paymentMethodId: string) {
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });

    if (!method) {
      throw new NotFoundException(
        `Payment method with id "${paymentMethodId}" not found`,
      );
    }

    if (method.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // Unset all other defaults for this user, then set the chosen one
    await this.prisma.$transaction([
      this.prisma.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDefault: true },
      }),
    ]);

    return this.prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });
  }
}
