import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
  status: string;
  amount: number; // smallest currency unit (cents)
  currency: string;
}

export interface StripeEvent {
  type: string;
  data: { object: Record<string, any> };
}

/**
 * Thin wrapper over the Stripe SDK with a deterministic MOCK mode.
 *
 * When STRIPE_SECRET_KEY is set, calls hit the real Stripe API. When it is
 * empty (dev/demo), the same methods return deterministic fake objects so the
 * whole payment flow is exercisable without keys. Set keys in .env to go live —
 * no code change required.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  // `Stripe` is exported as a namespace under nodenext; use the instance type.
  private readonly stripe: InstanceType<typeof Stripe> | null;
  readonly isMock: boolean;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('stripe.secretKey');
    if (key) {
      this.stripe = new Stripe(key);
      this.isMock = false;
    } else {
      this.stripe = null;
      this.isMock = true;
      this.logger.warn(
        'STRIPE_SECRET_KEY not set — Stripe is running in MOCK mode.',
      );
    }
  }

  async createPaymentIntent(params: {
    amount: number; // cents
    currency?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntentResult> {
    const currency = params.currency ?? 'usd';
    const amount = Math.round(params.amount);

    if (this.isMock || !this.stripe) {
      const ref = params.metadata?.deliveryId ?? `${amount}`;
      const id = `pi_mock_${ref}`;
      return {
        id,
        clientSecret: `${id}_secret_mock`,
        status: 'succeeded',
        amount,
        currency,
      };
    }

    const intent = await this.stripe.paymentIntents.create({
      amount,
      currency,
      metadata: params.metadata,
      automatic_payment_methods: { enabled: true },
    });

    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      amount,
      currency,
    };
  }

  /**
   * Verifies and parses a Stripe webhook. In mock mode the signature check is
   * skipped and the raw JSON body is parsed directly.
   */
  constructEvent(payload: Buffer | string, signature?: string): StripeEvent {
    if (this.isMock || !this.stripe) {
      const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
      return JSON.parse(raw) as StripeEvent;
    }

    const secret = this.config.get<string>('stripe.webhookSecret') ?? '';
    return this.stripe.webhooks.constructEvent(
      payload,
      signature ?? '',
      secret,
    ) as unknown as StripeEvent;
  }
}
