import { Injectable } from '@nestjs/common';

import { EstimatePriceDto } from './dto';

const SIZE_FEES: Record<string, number> = {
  Small: 3,
  Medium: 6,
  Large: 10,
  XL: 16,
};

const TYPE_SURCHARGES: Record<string, number> = {
  fragile: 2,
  electronics: 2,
  food: 1,
  healthcare: 1,
};

@Injectable()
export class PricingService {
  estimate(dto: EstimatePriceDto) {
    const baseFee = 2;
    const sizeFee = SIZE_FEES[dto.packageSize] ?? 0;
    const weightFee = Math.round(dto.packageWeight * 3 * 100) / 100;

    const typeFee = dto.packageTypes.reduce(
      (sum, type) => sum + (TYPE_SURCHARGES[type] ?? 0),
      0,
    );

    const total = baseFee + sizeFee + weightFee + typeFee;

    return { baseFee, sizeFee, weightFee, typeFee, total };
  }
}
