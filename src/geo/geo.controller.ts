import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { GeoService } from './geo.service';
import {
  GeocodeResponseDto,
  ReverseGeocodeResponseDto,
} from './dto/geo-response.dto';

@Controller('geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('geocode')
  @ApiOkResponse({ type: GeocodeResponseDto })
  async geocode(
    @Query('q') q: string,
  ): Promise<{ data: { lat: number; lng: number } | null }> {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    const result = await this.geoService.geocode(q);

    return { data: result };
  }

  @Get('reverse')
  @ApiOkResponse({ type: ReverseGeocodeResponseDto })
  async reverseGeocode(@Query('lat') lat: number, @Query('lng') lng: number) {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
      throw new BadRequestException(
        'Query parameters "lat" and "lng" are required and must be numbers',
      );
    }

    const address = await this.geoService.reverseGeocode(lat, lng);

    return { data: address };
  }
}
