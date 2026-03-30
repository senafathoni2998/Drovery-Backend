import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'Drovery/1.0';

interface GeocodeResult {
  lat: number;
  lng: number;
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(private readonly config: ConfigService) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: '1',
      });

      const response = await fetch(
        `${NOMINATIM_BASE_URL}/search?${params.toString()}`,
        {
          headers: { 'User-Agent': USER_AGENT },
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Nominatim geocode request failed with status ${response.status}`,
        );
        return null;
      }

      const results = await response.json();

      if (!Array.isArray(results) || results.length === 0) {
        return null;
      }

      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
      };
    } catch (error) {
      this.logger.error(
        `Geocode failed for query "${query}": ${error.message}`,
      );
      return null;
    }
  }

  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: 'json',
      });

      const response = await fetch(
        `${NOMINATIM_BASE_URL}/reverse?${params.toString()}`,
        {
          headers: { 'User-Agent': USER_AGENT },
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Nominatim reverse geocode request failed with status ${response.status}`,
        );
        return null;
      }

      const result = await response.json();

      return result?.display_name ?? null;
    } catch (error) {
      this.logger.error(
        `Reverse geocode failed for (${lat}, ${lng}): ${error.message}`,
      );
      return null;
    }
  }
}
