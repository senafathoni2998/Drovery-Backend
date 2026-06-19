import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StripeService, StripeEvent } from '../stripe/stripe.service';
import { AddPaymentMethodDto } from './dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stripe: StripeService,
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

  // ── Charges (PaymentIntents) ──────────────────────────────────────────────

  /**
   * Creates a Stripe PaymentIntent for a delivery and records a Payment row.
   * Idempotent per delivery (the Payment.deliveryId is unique), so retries and
   * re-creates don't double-charge.
   */
  async createDeliveryPayment(
    deliveryId: string,
    deliveryCreatedAt: Date,
    amount: number,
  ) {
    const existing = await this.prisma.payment.findUnique({
      where: { deliveryId },
    });
    if (existing) return existing;

    const intent = await this.stripe.createPaymentIntent({
      amount: Math.round(amount * 100), // dollars → cents
      currency: 'usd',
      metadata: { deliveryId },
    });

    const payment = await this.prisma.payment.create({
      data: {
        deliveryId,
        deliveryCreatedAt,
        stripePaymentIntentId: intent.id,
        amount,
        currency: intent.currency,
        status: this.mapIntentStatus(intent.status),
      },
    });

    this.logger.log(
      `Payment ${payment.id} (${intent.status}) created for delivery ${deliveryId}` +
        (this.stripe.isMock ? ' [mock]' : ''),
    );

    return payment;
  }

  /**
   * Applies a verified Stripe webhook event to the matching Payment row.
   */
  async handleWebhookEvent(event: StripeEvent) {
    const intentId = event?.data?.object?.id;
    if (!intentId) return { received: true };

    const statusByType: Record<string, PaymentStatus> = {
      'payment_intent.succeeded': PaymentStatus.COMPLETED,
      'payment_intent.payment_failed': PaymentStatus.FAILED,
      'payment_intent.processing': PaymentStatus.PROCESSING,
      'payment_intent.canceled': PaymentStatus.FAILED,
    };

    const status = statusByType[event.type];
    if (status) {
      const result = await this.prisma.payment.updateMany({
        where: { stripePaymentIntentId: intentId },
        data: { status },
      });
      this.logger.log(
        `Webhook ${event.type} → ${result.count} payment(s) set to ${status}`,
      );
    }

    return { received: true };
  }

  private mapIntentStatus(stripeStatus: string): PaymentStatus {
    switch (stripeStatus) {
      case 'succeeded':
        return PaymentStatus.COMPLETED;
      case 'processing':
        return PaymentStatus.PROCESSING;
      case 'canceled':
        return PaymentStatus.FAILED;
      default:
        // requires_payment_method | requires_confirmation | requires_action
        return PaymentStatus.PENDING;
    }
  }

  // ── Native card entry (Stripe PaymentSheet) ───────────────────────────────

  /**
   * Returns everything the mobile Stripe PaymentSheet needs to save a card:
   * ensures the user has a Stripe Customer, then mints a SetupIntent + ephemeral
   * key. In mock mode these are deterministic fakes.
   */
  async createSetupSession(userId: string) {
    const customerId = await this.ensureStripeCustomer(userId);
    const session = await this.stripe.createSetupSession(customerId);
    return {
      ...session,
      publishableKey: this.stripe.publishableKey,
      mock: this.stripe.isMock,
    };
  }

  /**
   * Reconciles the user's locally-stored cards with Stripe (call after the
   * PaymentSheet saves a card). No-op in mock mode (Stripe returns no cards).
   */
  async syncCards(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) return this.findAll(userId);

    const cards = await this.stripe.listCards(user.stripeCustomerId);
    for (const card of cards) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { userId, stripePaymentMethodId: card.id },
      });
      if (!existing) {
        const count = await this.prisma.paymentMethod.count({
          where: { userId },
        });
        await this.prisma.paymentMethod.create({
          data: {
            userId,
            stripePaymentMethodId: card.id,
            network: card.brand,
            last4: card.last4,
            holderName: user.name,
            expiry: `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`,
            isDefault: count === 0,
          },
        });
      }
    }

    return this.findAll(userId);
  }

  private async ensureStripeCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customerId = await this.stripe.createCustomer({
      email: user.email,
      name: user.name,
      metadata: { userId },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
    return customerId;
  }
}
