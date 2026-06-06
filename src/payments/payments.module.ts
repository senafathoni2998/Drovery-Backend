import { Module } from '@nestjs/common';

import { StripeModule } from '../stripe/stripe.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [StripeModule],
  controllers: [PaymentsController, WebhookController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
