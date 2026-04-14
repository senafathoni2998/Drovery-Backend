import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

describe('GeoController', () => {
  let controller: GeoController;
  let geoService: { geocode: jest.Mock; reverseGeocode: jest.Mock };

  beforeEach(async () => {
    geoService = {
      geocode: jest.fn().mockResolvedValue({ lat: -6.903, lng: 107.615 }),
      reverseGeocode: jest.fn().mockResolvedValue('Bandung, West Java'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeoController],
      providers: [{ provide: GeoService, useValue: geoService }],
    }).compile();

    controller = module.get<GeoController>(GeoController);
  });

  describe('geocode', () => {
    it('should delegate to geoService.geocode', async () => {
      const result = await controller.geocode('Bandung');

      expect(geoService.geocode).toHaveBeenCalledWith('Bandung');
      expect(result).toEqual({ data: { lat: -6.903, lng: 107.615 } });
    });

    it('should throw BadRequestException for empty query', async () => {
      await expect(controller.geocode('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('reverseGeocode', () => {
    it('should delegate to geoService.reverseGeocode', async () => {
      const result = await controller.reverseGeocode(-6.903, 107.615);

      expect(geoService.reverseGeocode).toHaveBeenCalledWith(-6.903, 107.615);
      expect(result).toEqual({ data: 'Bandung, West Java' });
    });

    it('should throw BadRequestException for missing coordinates', async () => {
      await expect(
        controller.reverseGeocode(null as any, null as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
