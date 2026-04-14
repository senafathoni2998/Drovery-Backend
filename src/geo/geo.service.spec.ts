import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { GeoService } from './geo.service';

describe('GeoService', () => {
  let service: GeoService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<GeoService>(GeoService);
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('geocode', () => {
    it('should return lat/lng for a valid query', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '-6.903', lon: '107.615' }],
      } as Response);

      const result = await service.geocode('Bandung, Indonesia');

      expect(result).toEqual({ lat: -6.903, lng: 107.615 });
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
