import { Body, Controller, Post } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { EstimatePriceDto } from './dto';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('estimate')
  @Public()
  estimate(@Body() dto: EstimatePriceDto) {
    return this.pricingService.estimate(dto);
  }
}
