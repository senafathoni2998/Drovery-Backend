import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { StripeService } from './stripe.service';

describe('StripeService (mock mode)', () => {
  let service: StripeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  it('runs in mock mode when no secret key is configured', () => {
    expect(service.isMock).toBe(true);
  });

  it('createPaymentIntent returns a deterministic mock intent (dollars stay cents)', async () => {
    const intent = await service.createPaymentIntent({
      amount: 1800,
      metadata: { deliveryId: 'd-1' },
    });

    expect(intent.id).toBe('pi_mock_d-1');
    expect(intent.status).toBe('succeeded');
    expect(intent.amount).toBe(1800);
    expect(intent.currency).toBe('usd');
    expect(intent.clientSecret).toContain('secret');
  });

  it('constructEvent fails CLOSED in mock mode — refuses unsigned events (no fail-open)', () => {
    const body = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    });

    // Mock mode has no signing secret, so an unsigned payload is unverifiable. It must be
    // REFUSED (not parsed) so a forged event can't mutate payment state via the public webhook.
    expect(() => service.constructEvent(Buffer.from(body))).toThrow(
      /disabled in mock mode/i,
    );
  });

  it('createCustomer returns a deterministic mock id', async () => {
    const id = await service.createCustomer({
      email: 'a@b.com',
      metadata: { userId: 'u1' },
    });
    expect(id).toBe('cus_mock_u1');
  });

  it('createSetupSession returns deterministic mock secrets', async () => {
    const s = await service.createSetupSession('cus_1');
    expect(s.setupIntentClientSecret).toContain('seti_mock');
    expect(s.ephemeralKeySecret).toContain('ek_mock');
    expect(s.customerId).toBe('cus_1');
  });

  it('listCards is empty and publishableKey is null in mock mode', async () => {
    expect(await service.listCards('cus_1')).toEqual([]);
    expect(service.publishableKey).toBeNull();
  });
});

describe('StripeService (live mode)', () => {
  const make = (over: Record<string, string | undefined> = {}) => {
    const cfg: Record<string, string | undefined> = {
      'stripe.secretKey': 'sk_test_dummy',
      'stripe.webhookSecret': undefined,
      ...over,
    };
    return new StripeService({
      get: (k: string) => cfg[k],
    } as unknown as ConfigService);
  };

  it('is NOT in mock mode when a secret key is configured', () => {
    expect(make().isMock).toBe(false);
  });

  it('constructEvent fails closed (throws) when no webhook secret is configured', () => {
    // Defense-in-depth: never verify a signature against an empty secret (which would
    // accept any payload). The controller maps this throw to 400.
    expect(() => make().constructEvent(Buffer.from('{}'), 'sig')).toThrow(
      /STRIPE_WEBHOOK_SECRET is not configured/,
    );
  });
});
