import { Test, TestingModule } from '@nestjs/testing';

import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

describe('PricingController', () => {
  let controller: PricingController;
  let pricingService: { estimate: jest.Mock };

  beforeEach(async () => {
    pricingService = {
      estimate: jest.fn().mockReturnValue({
        baseFee: 2,
        sizeFee: 6,
        weightFee: 6,
        typeFee: 4,
        total: 18,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PricingController],
      providers: [{ provide: PricingService, useValue: pricingService }],
    }).compile();

    controller = module.get<PricingController>(PricingController);
  });

  describe('estimate', () => {
    it('should delegate to pricingService.estimate', () => {
      const dto = {
        packageSize: 'Medium',
        packageWeight: 2,
        packageTypes: ['electronics', 'fragile'],
      };

      const result = controller.estimate(dto as any);

      expect(pricingService.estimate).toHaveBeenCalledWith(dto);
      expect(result.total).toBe(18);
    });
  });
});
