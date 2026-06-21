import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';

import { PublicApi } from '../common/decorators/public-api.decorator';
import { EstimatePriceDto } from './dto';
import { PriceEstimateResponseDto } from './dto/pricing-response.dto';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('estimate')
  @PublicApi()
  @ApiCreatedResponse({ type: PriceEstimateResponseDto })
  estimate(@Body() dto: EstimatePriceDto) {
    return this.pricingService.estimate(dto);
  }
}
