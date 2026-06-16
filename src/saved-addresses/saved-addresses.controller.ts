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
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SavedAddressesService } from './saved-addresses.service';
import { CreateSavedAddressDto, UpdateSavedAddressDto } from './dto';
import {
  RecentAddressDto,
  RemoveSavedAddressResponseDto,
  SavedAddressResponseDto,
} from './dto/saved-address-response.dto';

@Controller('addresses')
export class SavedAddressesController {
  constructor(private readonly service: SavedAddressesService) {}

  @Get()
  @ApiOkResponse({ type: [SavedAddressResponseDto] })
  findAll(@CurrentUser('sub') userId: string) {
    return this.service.findAll(userId);
  }

  // Must precede ':id' so it isn't captured as a param route.
  @Get('recent')
  @ApiOkResponse({ type: [RecentAddressDto] })
  getRecent(@CurrentUser('sub') userId: string) {
    return this.service.getRecent(userId);
  }

  @Post()
  @ApiCreatedResponse({ type: SavedAddressResponseDto })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSavedAddressDto,
  ) {
    return this.service.create(userId, dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: SavedAddressResponseDto })
  findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: SavedAddressResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavedAddressDto,
  ) {
    return this.service.update(userId, id, dto);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SavedAddressResponseDto })
  setDefault(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.setDefault(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RemoveSavedAddressResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
