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
import {
  ConfirmHandoffDto,
  CreateDeliveryDto,
  DeliveryQueryDto,
  ReorderDto,
} from './dto';

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
  findByTrackingId(
    @CurrentUser('sub') userId: string,
    @Query('trackingId') trackingId: string,
  ) {
    return this.deliveriesService.findByTrackingId(userId, trackingId);
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

  // "Send again" — clone this delivery into a new one (immediate by default).
  @Post(':id/reorder')
  reorder(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ReorderDto,
  ) {
    return this.deliveriesService.reorder(userId, id, dto);
  }

  @Post(':id/confirm-handoff')
  @HttpCode(HttpStatus.OK)
  confirmHandoff(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmHandoffDto,
  ) {
    return this.deliveriesService.confirmHandoff(userId, id, dto.code);
  }
}
