import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreatedDeliveryResponseDto } from '../deliveries/dto/delivery-response.dto';
import { CreateFavoriteDto, OrderFavoriteDto } from './dto/favorite.dto';
import { FavoriteResponseDto } from './dto/favorite-response.dto';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post()
  @ApiCreatedResponse({ type: FavoriteResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateFavoriteDto) {
    return this.favorites.create(userId, dto);
  }

  @Get()
  @ApiOkResponse({ type: [FavoriteResponseDto] })
  findAll(@CurrentUser('sub') userId: string) {
    return this.favorites.findAll(userId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.favorites.remove(userId, id);
  }

  // Place a delivery from a saved favorite.
  @Post(':id/order')
  @ApiCreatedResponse({ type: CreatedDeliveryResponseDto })
  order(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: OrderFavoriteDto,
  ) {
    return this.favorites.order(userId, id, dto);
  }
}
