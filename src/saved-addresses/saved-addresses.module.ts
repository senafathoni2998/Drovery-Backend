import { Module } from '@nestjs/common';

import { GeoModule } from '../geo/geo.module';
import { SavedAddressesController } from './saved-addresses.controller';
import { SavedAddressesService } from './saved-addresses.service';

@Module({
  imports: [GeoModule],
  controllers: [SavedAddressesController],
  providers: [SavedAddressesService],
  exports: [SavedAddressesService],
})
export class SavedAddressesModule {}
