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
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DeliveriesService } from './deliveries.service';
import {
  ConfirmHandoffDto,
  CreateDeliveryDto,
  DeliveryQueryDto,
  ReorderDto,
} from './dto';
import {
  CreatedDeliveryResponseDto,
  DeliveryResponseDto,
  PaginatedDeliveriesDto,
} from './dto/delivery-response.dto';

@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post()
  @ApiCreatedResponse({ type: CreatedDeliveryResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateDeliveryDto) {
    return this.deliveriesService.create(userId, dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedDeliveriesDto })
  findAll(
    @CurrentUser('sub') userId: string,
    @Query() query: DeliveryQueryDto,
  ) {
    return this.deliveriesService.findAll(userId, query);
  }

  @Get('active')
  @ApiOkResponse({ type: [DeliveryResponseDto] })
  getActive(@CurrentUser('sub') userId: string) {
    return this.deliveriesService.getActive(userId);
  }

  @Get('recent')
  @ApiOkResponse({ type: [DeliveryResponseDto] })
  getRecent(@CurrentUser('sub') userId: string) {
    return this.deliveriesService.getRecent(userId);
  }

  @Get('track')
  @ApiOkResponse({ type: DeliveryResponseDto })
  findByTrackingId(
    @CurrentUser('sub') userId: string,
    @Query('trackingId') trackingId: string,
  ) {
    return this.deliveriesService.findByTrackingId(userId, trackingId);
  }

  @Get(':id')
  @ApiOkResponse({ type: DeliveryResponseDto })
  findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.deliveriesService.findOne(userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DeliveryResponseDto })
  cancel(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.deliveriesService.cancel(userId, id);
  }

  // "Send again" — clone this delivery into a new one (immediate by default).
  @Post(':id/reorder')
  @ApiCreatedResponse({ type: CreatedDeliveryResponseDto })
  reorder(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ReorderDto,
  ) {
    return this.deliveriesService.reorder(userId, id, dto);
  }

  @Post(':id/confirm-handoff')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DeliveryResponseDto })
  confirmHandoff(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmHandoffDto,
  ) {
    return this.deliveriesService.confirmHandoff(userId, id, dto.code);
  }
}
