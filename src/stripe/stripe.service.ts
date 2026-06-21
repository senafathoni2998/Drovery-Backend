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
  // The Stripe event id (evt_…). Present on real events; used for webhook
  // idempotency (a redelivered event has the same id). Optional so the mock /
  // local path, which may not carry one, still type-checks.
  id?: string;
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

  get publishableKey(): string | null {
    return this.config.get<string>('stripe.publishableKey') ?? null;
  }

  /** Creates (or in mock mode fakes) a Stripe Customer and returns its id. */
  async createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<string> {
    if (this.isMock || !this.stripe) {
      return `cus_mock_${params.metadata?.userId ?? 'x'}`;
    }
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });
    return customer.id;
  }

  /**
   * Creates a SetupIntent + ephemeral key so the mobile PaymentSheet can save a
   * card to the customer. In mock mode returns deterministic fakes.
   */
  async createSetupSession(customerId: string): Promise<{
    setupIntentClientSecret: string;
    ephemeralKeySecret: string | null;
    customerId: string;
  }> {
    if (this.isMock || !this.stripe) {
      return {
        setupIntentClientSecret: `seti_mock_${customerId}_secret`,
        ephemeralKeySecret: `ek_mock_${customerId}`,
        customerId,
      };
    }

    const setupIntent = await this.stripe.setupIntents.create({
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });
    const ephemeralKey = await this.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2024-06-20' },
    );

    return {
      setupIntentClientSecret: setupIntent.client_secret ?? '',
      ephemeralKeySecret: ephemeralKey.secret ?? null,
      customerId,
    };
  }

  /** Lists the customer's saved cards (normalized). Empty in mock mode. */
  async listCards(customerId: string): Promise<
    {
      id: string;
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    }[]
  > {
    if (this.isMock || !this.stripe) {
      return [];
    }
    const methods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '0000',
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
    }));
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
