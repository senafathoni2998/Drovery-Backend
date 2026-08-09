import { Module } from '@nestjs/common';

import { AirspaceService } from './airspace.service';
import { ServiceabilityService } from './serviceability.service';
import { WeatherService } from './weather.service';

// Leaf module: imports nothing from Pricing/Deliveries (no cycle). CacheModule and
// PrismaModule are both @Global, so WeatherService's CacheService dependency and
// AirspaceService's PrismaService dependency resolve without an import.
@Module({
  providers: [ServiceabilityService, WeatherService, AirspaceService],
  exports: [ServiceabilityService, AirspaceService],
})
export class ServiceabilityModule {}
