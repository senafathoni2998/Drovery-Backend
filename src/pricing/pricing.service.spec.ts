import { Test, TestingModule } from '@nestjs/testing';

import { PricingService } from './pricing.service';

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService],
    }).compile();

    service = module.get<PricingService>(PricingService);
  });

  describe('estimate', () => {
    it('should calculate base fee + size fee for Small package', () => {
      const result = service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: [],
      });

      expect(result.baseFee).toBe(2);
      expect(result.sizeFee).toBe(3);
      expect(result.weightFee).toBe(0);
      expect(result.typeFee).toBe(0);
      expect(result.total).toBe(5);
    });

    it('should calculate correct size fees for all sizes', () => {
      const sizes = { Small: 3, Medium: 6, Large: 10, XL: 16 };

      for (const [size, expectedFee] of Object.entries(sizes)) {
        const result = service.estimate({
          packageSize: size,
          packageWeight: 0,
          packageTypes: [],
        });
        expect(result.sizeFee).toBe(expectedFee);
      }
    });

    it('should calculate weight fee as weight * 3', () => {
      const result = service.estimate({
        packageSize: 'Small',
        packageWeight: 2.5,
        packageTypes: [],
      });

      expect(result.weightFee).toBe(7.5);
    });

    it('should calculate type surcharges', () => {
      const result = service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: ['fragile', 'electronics', 'food'],
      });

      // fragile(2) + electronics(2) + food(1) = 5
      expect(result.typeFee).toBe(5);
    });

    it('should return 0 type fee for unknown package types', () => {
      const result = service.estimate({
        packageSize: 'Small',
        packageWeight: 0,
        packageTypes: ['unknown_type'],
      });

      expect(result.typeFee).toBe(0);
    });

    it('should calculate combined total correctly', () => {
      const result = service.estimate({
        packageSize: 'Medium',
        packageWeight: 2,
        packageTypes: ['electronics', 'fragile'],
      });

      // base(2) + size.Medium(6) + weight(2*3=6) + electronics(2) + fragile(2) = 18
      expect(result.total).toBe(18);
    });
  });
});
