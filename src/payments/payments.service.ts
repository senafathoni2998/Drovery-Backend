import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/exceptions/app-exception';
import { StripeService, StripeEvent } from '../stripe/stripe.service';
import { AddPaymentMethodDto } from './dto';

/** Stripe event type → the PaymentStatus it represents. */
const WEBHOOK_STATUS: Record<string, PaymentStatus> = {
  'payment_intent.succeeded': PaymentStatus.COMPLETED,
  'payment_intent.payment_failed': PaymentStatus.FAILED,
  'payment_intent.processing': PaymentStatus.PROCESSING,
  'payment_intent.canceled': PaymentStatus.FAILED,
};

/**
 * Monotonic webhook CAS: the prior statuses a target may legally advance FROM.
 * Stripe delivers webhooks AT-LEAST-ONCE and can REORDER them, so a blind status
 * write would regress a payment — a stale `processing` after `succeeded`, or a
 * redelivered `payment_failed` after the charge COMPLETED (which could wrongly
 * trigger a refund). Restricting the UPDATE's WHERE to these prior states makes any
 * such event a 0-row no-op. A success wins even over a prior FAILED (a retried
 * intent); a failure never overwrites a COMPLETED or REFUNDED payment.
 */
const ADVANCE_FROM: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [],
  [PaymentStatus.PROCESSING]: [PaymentStatus.PENDING],
  [PaymentStatus.COMPLETED]: [
    PaymentStatus.PENDING,
    PaymentStatus.PROCESSING,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.FAILED]: [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
  [PaymentStatus.REFUNDED]: [], // only the refund flow sets REFUNDED — never a webhook
};

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
      throw new AppNotFoundException('error.payment.method.not_found', {
        id: paymentMethodId,
      });
    }

    if (method.userId !== userId) {
      throw new AppForbiddenException('error.authz.access_denied');
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
      throw new AppNotFoundException('error.payment.method.not_found', {
        id: paymentMethodId,
      });
    }

    if (method.userId !== userId) {
      throw new AppForbiddenException('error.authz.access_denied');
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
   * Applies a verified Stripe webhook event to the matching Payment row —
   * IDEMPOTENTLY (deduped on the event id) and MONOTONICALLY (never regresses a
   * payment), because Stripe delivers at-least-once and can reorder events.
   */
  async handleWebhookEvent(event: StripeEvent) {
    const eventId = event?.id;
    const intentId = event?.data?.object?.id;
    if (!intentId) return { received: true };

    const target = WEBHOOK_STATUS[event.type];

    // The status write only touches rows currently in an allowed PRIOR status, so a
    // stale, duplicate, or out-of-order event matches 0 rows and is a safe no-op.
    const applyStatus = (
      client: Pick<PrismaService, 'payment'>,
    ): Promise<{ count: number }> =>
      target
        ? client.payment.updateMany({
            where: {
              stripePaymentIntentId: intentId,
              status: { in: ADVANCE_FROM[target] },
            },
            data: { status: target },
          })
        : Promise.resolve({ count: 0 });

    // With an event id (always present on real Stripe events) record it for
    // idempotency in the SAME transaction as the status write — so the event is
    // marked processed only once the update commits, and a crash between the two
    // re-processes on Stripe's redelivery instead of silently dropping the update.
    if (eventId) {
      try {
        const { count } = await this.prisma.$transaction(async (tx) => {
          await tx.webhookEvent.create({
            data: { id: eventId, type: event.type },
          });
          return applyStatus(tx);
        });
        this.logWebhook(event.type, target, count);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          // The event id already exists → a redelivery. Acknowledge and skip.
          this.logger.log(
            `Webhook ${event.type} (${eventId}) already processed — skipped`,
          );
          return { received: true, duplicate: true };
        }
        throw e;
      }
      return { received: true };
    }

    // No event id (mock / local): the monotonic guard alone still makes the write safe.
    const { count } = await applyStatus(this.prisma);
    this.logWebhook(event.type, target, count);
    return { received: true };
  }

  private logWebhook(
    type: string,
    target: PaymentStatus | undefined,
    count: number,
  ) {
    if (!target) return;
    this.logger.log(
      `Webhook ${type} → ${count} payment(s) ${
        count ? `set to ${target}` : 'unchanged (stale/duplicate)'
      }`,
    );
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
      throw new AppNotFoundException('error.user.not_found');
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
