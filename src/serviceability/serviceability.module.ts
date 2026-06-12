import { Module } from '@nestjs/common';

import { ServiceabilityService } from './serviceability.service';
import { WeatherService } from './weather.service';

// Leaf module: imports nothing from Pricing/Deliveries (no cycle). CacheModule is
// @Global, so WeatherService's CacheService dependency resolves without an import.
@Module({
  providers: [ServiceabilityService, WeatherService],
  exports: [ServiceabilityService],
})
export class ServiceabilityModule {}
