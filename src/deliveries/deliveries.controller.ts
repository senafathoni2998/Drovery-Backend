import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto, DeliveryQueryDto } from './dto';

@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateDeliveryDto,
  ) {
    return this.deliveriesService.create(userId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('sub') userId: string,
    @Query() query: DeliveryQueryDto,
  ) {
    return this.deliveriesService.findAll(userId, query);
  }

  @Get('active')
  getActive(@CurrentUser('sub') userId: string) {
    return this.deliveriesService.getActive(userId);
  }

  @Get('recent')
  getRecent(@CurrentUser('sub') userId: string) {
    return this.deliveriesService.getRecent(userId);
  }

  @Get('track')
  findByTrackingId(@Query('trackingId') trackingId: string) {
    return this.deliveriesService.findByTrackingId(trackingId);
  }

  @Get(':id')
  findOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveriesService.findOne(userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveriesService.cancel(userId, id);
  }
}
