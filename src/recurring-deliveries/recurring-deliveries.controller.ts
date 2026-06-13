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

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateRecurringDeliveryDto, RecurringQueryDto } from './dto';
import { RecurringDeliveriesService } from './recurring-deliveries.service';

@Controller('recurring-deliveries')
export class RecurringDeliveriesController {
  constructor(private readonly service: RecurringDeliveriesService) {}

  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateRecurringDeliveryDto,
  ) {
    return this.service.create(userId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('sub') userId: string,
    @Query() query: RecurringQueryDto,
  ) {
    return this.service.findAll(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.pause(userId, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.resume(userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
