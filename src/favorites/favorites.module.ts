import { Module } from '@nestjs/common';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [DeliveriesModule], // for DeliveriesService (snapshot + reorder via create)
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
