import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import { WebhookController } from './webhook.controller';
import { StripeService } from '../stripe/stripe.service';
import { PaymentsService } from './payments.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let stripe: { constructEvent: jest.Mock };
  let payments: { handleWebhookEvent: jest.Mock };

  beforeEach(async () => {
    stripe = { constructEvent: jest.fn() };
    payments = {
      handleWebhookEvent: jest.fn().mockResolvedValue({ received: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: StripeService, useValue: stripe },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('verifies the event and delegates to PaymentsService', async () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    };
    stripe.constructEvent.mockReturnValue(event);
    const req: any = { rawBody: Buffer.from('{}') };

    const result = await controller.handleWebhook(req, 'sig_123');

    expect(stripe.constructEvent).toHaveBeenCalledWith(req.rawBody, 'sig_123');
    expect(payments.handleWebhookEvent).toHaveBeenCalledWith(event);
    expect(result).toEqual({ received: true });
  });

  it('throws BadRequest when signature verification fails', async () => {
    stripe.constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const req: any = { rawBody: Buffer.from('{}') };

    await expect(controller.handleWebhook(req, 'bad')).rejects.toThrow(
      BadRequestException,
    );
  });
});
