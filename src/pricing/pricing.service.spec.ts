import { Test, TestingModule } from '@nestjs/testing';

import { PricingService, haversineKm } from './pricing.service';
import { GeoService } from '../geo/geo.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';

const SERVICEABLE = {
  serviceable: true,
  reasons: [],
  codes: [],
  weatherHold: false,
};

describe('PricingService', () => {
  let service: PricingService;
  let geoService: { geocode: jest.Mock };
  let serviceability: { checkServiceability: jest.Mock };

  beforeEach(async () => {
    geoService = { geocode: jest.fn().mockResolvedValue(null) };
    serviceability = {
      checkServiceability: jest.fn().mockResolvedValue(SERVICEABLE),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: GeoService, useValue: geoService },
        { provide: ServiceabilityService, useValue: serviceability },
      ],
    }).compile();

    service = module.get<PricingService>(PricingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('estimate (size/weight/type, no distance)', () => {
    it('should calculate base fee + size fee for Small package', async () => {
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
      });

      expect(result.baseFee).toBe(2);
      expect(result.sizeFee).toBe(3);
      expect(result.weightFee).toBe(0);
      expect(result.typeFee).toBe(0);
      expect(result.distanceFee).toBe(0);
      expect(result.total).toBe(5);
    });

    it('should calculate correct size fees for all sizes', async () => {
      const sizes = { Small: 3, Medium: 6, Large: 10, XL: 16 };

      for (const [size, expectedFee] of Object.entries(sizes)) {
        const result = await service.estimate({
          packageSize: size,
          packageWeight: 0,
          packageTypes: [],
        });
        expect(result.sizeFee).toBe(expectedFee);
      }
    });

    it('should calculate weight fee as weight * 3', async () => {
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 2.5,
        packageTypes: [],
      });

      expect(result.weightFee).toBe(7.5);
    });

    it('should calculate type surcharges', async () => {
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: ['fragile', 'electronics', 'food'],
      });

      // fragile(2) + electronics(2) + food(1) = 5
      expect(result.typeFee).toBe(5);
    });

    it('should return 0 type fee for unknown package types', async () => {
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: ['unknown_type'],
      });

      expect(result.typeFee).toBe(0);
    });

    it('should calculate combined total correctly (no coords → no distance)', async () => {
      const result = await service.estimate({
        packageSize: 'Medium',
        packageWeight: 2,
        packageTypes: ['electronics', 'fragile'],
      });

      // base(2) + size.Medium(6) + weight(2*3=6) + electronics(2) + fragile(2) = 18
      expect(result.distanceFee).toBe(0);
      expect(result.total).toBe(18);
    });
  });

  describe('distance pricing', () => {
    it('uses supplied coordinates directly (no geocoding) and charges $1.5/km', async () => {
      // ~10 km apart
      const km = haversineKm(-6.9, 107.6, -6.99, 107.6);
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
        fromLat: -6.9,
        fromLng: 107.6,
        toLat: -6.99,
        toLng: 107.6,
      });

      expect(geoService.geocode).not.toHaveBeenCalled();
      expect(result.distanceKm).toBeCloseTo(Math.round(km * 100) / 100, 2);
      expect(result.distanceFee).toBeCloseTo(
        Math.round(km * 1.5 * 100) / 100,
        2,
      );
      // total = base(2) + size.Small(3) + distanceFee
      expect(result.total).toBeCloseTo(5 + result.distanceFee, 2);
    });

    it('geocodes the addresses when coordinates are absent', async () => {
      geoService.geocode
        .mockResolvedValueOnce({ lat: -6.9, lng: 107.6 })
        .mockResolvedValueOnce({ lat: -6.99, lng: 107.6 });

      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
        fromAddress: 'Pickup',
        toAddress: 'Dropoff',
      });

      expect(geoService.geocode).toHaveBeenCalledWith('Pickup');
      expect(geoService.geocode).toHaveBeenCalledWith('Dropoff');
      expect(result.distanceFee).toBeGreaterThan(0);
    });

    it('falls back to 0 distance when geocoding fails', async () => {
      geoService.geocode.mockResolvedValue(null);

      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
        fromAddress: 'Nowhere',
        toAddress: 'Nowhere either',
      });

      expect(result.distanceFee).toBe(0);
      expect(result.total).toBe(5);
    });
  });

  describe('serviceability', () => {
    it('includes the serviceability block when the full route is known', async () => {
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
        fromLat: -6.9,
        fromLng: 107.6,
        toLat: -6.99,
        toLng: 107.6,
      });

      expect(serviceability.checkServiceability).toHaveBeenCalledWith(
        -6.9,
        107.6,
        -6.99,
        107.6,
      );
      expect(result.serviceability).toEqual(SERVICEABLE);
    });

    it('omits serviceability when coordinates cannot be resolved', async () => {
      const result = await service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
      });

      expect(serviceability.checkServiceability).not.toHaveBeenCalled();
      expect(result.serviceability).toBeUndefined();
    });
  });
});
