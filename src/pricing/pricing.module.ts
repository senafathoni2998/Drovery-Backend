import { Module } from '@nestjs/common';

import { GeoModule } from '../geo/geo.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [GeoModule, ServiceabilityModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
