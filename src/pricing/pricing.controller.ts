import { Body, Controller, Post } from '@nestjs/common';

import { PublicApi } from '../common/decorators/public-api.decorator';
import { EstimatePriceDto } from './dto';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('estimate')
  @PublicApi()
  estimate(@Body() dto: EstimatePriceDto) {
    return this.pricingService.estimate(dto);
  }
}
