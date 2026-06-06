import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { GeoService } from './geo.service';
import { CacheService } from '../cache/cache.service';

describe('GeoService', () => {
  let service: GeoService;
  let fetchSpy: jest.SpyInstance;
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    cache = {
      get: jest.fn().mockResolvedValue(null), // default: cache miss
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<GeoService>(GeoService);
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('geocode', () => {
    it('should return lat/lng for a valid query and cache it', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '-6.903', lon: '107.615' }],
      } as Response);

      const result = await service.geocode('Bandung, Indonesia');

      expect(result).toEqual({ lat: -6.903, lng: 107.615 });
      // result is written to the cache under a normalized key with a long TTL
      const setCall = cache.set.mock.calls[0];
      expect(setCall[0]).toBe('geo:fwd:bandung, indonesia');
      expect(setCall[1]).toEqual({ lat: -6.903, lng: 107.615 });
      expect(setCall[2]).toBeGreaterThan(86400);
    });

    it('returns the cached result without calling Nominatim on a hit', async () => {
      cache.get.mockResolvedValue({ lat: 1.1, lng: 2.2 });
      fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.geocode('Bandung, Indonesia');

      expect(result).toEqual({ lat: 1.1, lng: 2.2 });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('returns null on a negative-cache hit without calling Nominatim', async () => {
      cache.get.mockResolvedValue({ miss: true });
      fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.geocode('nowhere');

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return null for empty results', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const result = await service.geocode('nonexistent place');

      expect(result).toBeNull();
    });

    it('should return null on HTTP error', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await service.geocode('Bandung');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network error'));

      const result = await service.geocode('Bandung');

      expect(result).toBeNull();
    });
  });

  describe('reverseGeocode', () => {
    it('should return display name for valid coordinates', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ display_name: 'Bandung, West Java, Indonesia' }),
      } as Response);

      const result = await service.reverseGeocode(-6.903, 107.615);

      expect(result).toBe('Bandung, West Java, Indonesia');
    });

    it('should return null on error', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network error'));

      const result = await service.reverseGeocode(-6.903, 107.615);

      expect(result).toBeNull();
    });
  });
});
