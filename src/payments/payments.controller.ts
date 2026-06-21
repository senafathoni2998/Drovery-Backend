import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AddPaymentMethodDto } from './dto';
import {
  PaymentMethodResponseDto,
  RemovePaymentMethodResponseDto,
  SetupIntentResponseDto,
} from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@Controller('payment-methods')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOkResponse({ type: [PaymentMethodResponseDto] })
  findAll(@CurrentUser('sub') userId: string) {
    return this.paymentsService.findAll(userId);
  }

  @Post('setup-intent')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SetupIntentResponseDto })
  createSetupIntent(@CurrentUser('sub') userId: string) {
    return this.paymentsService.createSetupSession(userId);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: [PaymentMethodResponseDto] })
  sync(@CurrentUser('sub') userId: string) {
    return this.paymentsService.syncCards(userId);
  }

  @Post()
  @ApiCreatedResponse({ type: PaymentMethodResponseDto })
  addPaymentMethod(
    @CurrentUser('sub') userId: string,
    @Body() dto: AddPaymentMethodDto,
  ) {
    return this.paymentsService.addPaymentMethod(userId, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: RemovePaymentMethodResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.paymentsService.remove(userId, id);
  }

  @Patch(':id/default')
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  setDefault(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.paymentsService.setDefault(userId, id);
  }
}
