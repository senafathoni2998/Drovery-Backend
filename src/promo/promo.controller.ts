import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { PromoService } from './promo.service';

@Controller('promo')
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  // Advisory preview (never throws); create() is the authoritative enforcer.
  @Post('validate')
  @HttpCode(200)
  validate(
    @CurrentUser('sub') userId: string,
    @Body() dto: ValidatePromoDto,
  ) {
    return this.promo.preview(dto.code, userId, dto.orderTotal);
  }
}
