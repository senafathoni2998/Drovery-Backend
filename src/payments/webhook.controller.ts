import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { StripeService } from '../stripe/stripe.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    // Stripe signs the raw bytes; fall back to the parsed body for mock/local.
    const payload = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    let event;
    try {
      event = this.stripe.constructEvent(payload, signature);
    } catch (err) {
      this.logger.warn(`Rejected webhook: ${(err as Error).message}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    return this.payments.handleWebhookEvent(event);
  }
}
