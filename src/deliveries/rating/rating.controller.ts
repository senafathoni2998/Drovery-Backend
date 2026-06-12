import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateDeliveryDto } from './dto/rate-delivery.dto';
import { RatingService } from './rating.service';

@Controller('deliveries')
export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Post(':id/rating')
  rate(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: RateDeliveryDto,
  ) {
    return this.ratingService.rate(userId, id, dto);
  }

  @Get(':id/rating')
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.ratingService.getRating(userId, id);
  }
}
