import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AddPaymentMethodDto } from './dto';
import { PaymentsService } from './payments.service';

@Controller('payment-methods')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  findAll(@CurrentUser('sub') userId: string) {
    return this.paymentsService.findAll(userId);
  }

  @Post()
  addPaymentMethod(
    @CurrentUser('sub') userId: string,
    @Body() dto: AddPaymentMethodDto,
  ) {
    return this.paymentsService.addPaymentMethod(userId, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.paymentsService.remove(userId, id);
  }

  @Patch(':id/default')
  setDefault(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.paymentsService.setDefault(userId, id);
  }
}
