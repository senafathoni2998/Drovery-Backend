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
});
