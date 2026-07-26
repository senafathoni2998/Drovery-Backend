import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CacheService } from '../cache/cache.service';

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'Drovery/1.0';

// Addresses repeat heavily, so cache aggressively. Negative results get a short
// TTL so a typo'd address isn't re-queried against Nominatim's 1 req/sec limit.
const GEO_TTL_S = 30 * 24 * 3600; // 30 days
const GEO_MISS_TTL_S = 3600; // 1 hour

interface GeocodeResult {
  lat: number;
  lng: number;
}

// Cache envelope: either a hit (lat/lng) or a negative-cache sentinel.
type GeoCacheEntry = (GeocodeResult & { miss?: false }) | { miss: true };

/**
 * A geocode attempt's outcome. `not_found` (the provider answered, with nothing)
 * and `failed` (the provider never answered) are deliberately distinct: only the
 * former says anything about the address, and only the former may be cached.
 */
type GeocodeOutcome =
  | { status: 'found'; result: GeocodeResult }
  | { status: 'not_found' }
  | { status: 'failed' };
type ReverseCacheEntry = { address: string | null };

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const key = `geo:fwd:${query.trim().toLowerCase()}`;

    const cached = await this.cache.get<GeoCacheEntry>(key);
    if (cached) {
      return 'miss' in cached && cached.miss
        ? null
        : {
            lat: (cached as GeocodeResult).lat,
            lng: (cached as GeocodeResult).lng,
          };
    }

    const outcome = await this.fetchGeocode(query);

    // Only a real "the geocoder has no such address" answer is negative-cached.
    // A provider FAILURE (429 / 5xx / network) is not evidence about the address,
    // and caching it for GEO_MISS_TTL_S would turn one transient blip into an hour
    // of hard failures — deliveries fail closed on an unresolved location, so that
    // is an hour of rejected creates for every address that happened to be queried
    // during the blip. Leave the key unset and let the next call retry.
    if (outcome.status === 'failed') return null;

    await this.cache.set(
      key,
      outcome.status === 'found' ? outcome.result : { miss: true },
      outcome.status === 'found' ? GEO_TTL_S : GEO_MISS_TTL_S,
    );
    return outcome.status === 'found' ? outcome.result : null;
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    // Round to ~11 m so nearby coordinates share a cache entry.
    const key = `geo:rev:${lat.toFixed(4)},${lng.toFixed(4)}`;

    const cached = await this.cache.get<ReverseCacheEntry>(key);
    if (cached) return cached.address;

    const address = await this.fetchReverse(lat, lng);
    await this.cache.set(
      key,
      { address },
      address ? GEO_TTL_S : GEO_MISS_TTL_S,
    );
    return address;
  }

  // ── Nominatim calls ───────────────────────────────────────

  private async fetchGeocode(query: string): Promise<GeocodeOutcome> {
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: '1',
      });

      const response = await fetch(
        `${NOMINATIM_BASE_URL}/search?${params.toString()}`,
        { headers: { 'User-Agent': USER_AGENT } },
      );

      if (!response.ok) {
        // 429 (rate limit) / 5xx — the provider never gave us an answer.
        this.logger.warn(
          `Nominatim geocode request failed with status ${response.status}`,
        );
        return { status: 'failed' };
      }

      const results = await response.json();
      if (!Array.isArray(results)) {
        // A 200 whose body isn't the documented shape is a provider problem too.
        this.logger.warn('Nominatim geocode returned an unexpected payload');
        return { status: 'failed' };
      }
      if (results.length === 0) {
        // The provider answered: there is no such address. Safe to negative-cache.
        return { status: 'not_found' };
      }

      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        this.logger.warn(
          'Nominatim geocode returned an unparseable coordinate',
        );
        return { status: 'failed' };
      }

      return { status: 'found', result: { lat, lng } };
    } catch (error) {
      // Network error / abort / JSON parse failure — no answer, do not cache.
      this.logger.error(
        `Geocode failed for query "${query}": ${error.message}`,
      );
      return { status: 'failed' };
    }
  }

  private async fetchReverse(lat: number, lng: number): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: 'json',
      });

      const response = await fetch(
        `${NOMINATIM_BASE_URL}/reverse?${params.toString()}`,
        { headers: { 'User-Agent': USER_AGENT } },
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
