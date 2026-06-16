import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PromoValidateResponseDto } from './dto/promo-response.dto';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { PromoService } from './promo.service';

@Controller('promo')
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  // Advisory preview (never throws); create() is the authoritative enforcer.
  @Post('validate')
  @HttpCode(200)
  @ApiOkResponse({ type: PromoValidateResponseDto })
  validate(@CurrentUser('sub') userId: string, @Body() dto: ValidatePromoDto) {
    return this.promo.preview(dto.code, userId, dto.orderTotal);
  }
}
