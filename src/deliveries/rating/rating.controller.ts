import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeliveryRatingDto } from '../dto/delivery-response.dto';
import { RateDeliveryDto } from './dto/rate-delivery.dto';
import { RatingService } from './rating.service';

@Controller('deliveries')
export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Post(':id/rating')
  @ApiCreatedResponse({ type: DeliveryRatingDto })
  rate(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: RateDeliveryDto,
  ) {
    return this.ratingService.rate(userId, id, dto);
  }

  @Get(':id/rating')
  @ApiOkResponse({ type: DeliveryRatingDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.ratingService.getRating(userId, id);
  }
}
