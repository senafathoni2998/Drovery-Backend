import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateFavoriteDto, OrderFavoriteDto } from './dto/favorite.dto';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateFavoriteDto) {
    return this.favorites.create(userId, dto);
  }

  @Get()
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
  order(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: OrderFavoriteDto,
  ) {
    return this.favorites.order(userId, id, dto);
  }
}
