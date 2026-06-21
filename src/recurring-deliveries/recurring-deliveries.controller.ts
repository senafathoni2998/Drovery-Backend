import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateRecurringDeliveryDto, RecurringQueryDto } from './dto';
import {
  PaginatedRecurringDeliveriesDto,
  RecurringDeliveryResponseDto,
} from './dto/recurring-delivery-response.dto';
import { RecurringDeliveriesService } from './recurring-deliveries.service';

@Controller('recurring-deliveries')
export class RecurringDeliveriesController {
  constructor(private readonly service: RecurringDeliveriesService) {}

  @Post()
  @ApiCreatedResponse({ type: RecurringDeliveryResponseDto })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateRecurringDeliveryDto,
  ) {
    return this.service.create(userId, dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedRecurringDeliveriesDto })
  findAll(
    @CurrentUser('sub') userId: string,
    @Query() query: RecurringQueryDto,
  ) {
    return this.service.findAll(userId, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: RecurringDeliveryResponseDto })
  findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiOkResponse({ type: RecurringDeliveryResponseDto })
  pause(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.pause(userId, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiOkResponse({ type: RecurringDeliveryResponseDto })
  resume(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.resume(userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
