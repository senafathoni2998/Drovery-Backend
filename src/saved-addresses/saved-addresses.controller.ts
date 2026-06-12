import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SavedAddressesService } from './saved-addresses.service';
import { CreateSavedAddressDto, UpdateSavedAddressDto } from './dto';

@Controller('addresses')
export class SavedAddressesController {
  constructor(private readonly service: SavedAddressesService) {}

  @Get()
  findAll(@CurrentUser('sub') userId: string) {
    return this.service.findAll(userId);
  }

  // Must precede ':id' so it isn't captured as a param route.
  @Get('recent')
  getRecent(@CurrentUser('sub') userId: string) {
    return this.service.getRecent(userId);
  }

  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSavedAddressDto,
  ) {
    return this.service.create(userId, dto);
  }

  @Get(':id')
  findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavedAddressDto,
  ) {
    return this.service.update(userId, id, dto);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  setDefault(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.setDefault(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
