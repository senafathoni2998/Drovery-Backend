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

  it('constructEvent parses the raw JSON body without a signature in mock mode', () => {
    const body = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    });

    const event = service.constructEvent(Buffer.from(body));

    expect(event.type).toBe('payment_intent.succeeded');
    expect(event.data.object.id).toBe('pi_1');
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
