import { Injectable } from '@nestjs/common';

import { GeoService } from '../geo/geo.service';
import { EstimatePriceDto } from './dto';

const BASE_FEE = 2;
const WEIGHT_RATE = 3; // $ per kg

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

// Distance pricing
const PER_KM_RATE = 1.5; // $ per km flown
const EARTH_RADIUS_KM = 6371;

export interface PriceEstimate {
  baseFee: number;
  sizeFee: number;
  weightFee: number;
  typeFee: number;
  distanceKm: number;
  distanceFee: number;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class PricingService {
  constructor(private readonly geoService: GeoService) {}

  async estimate(dto: EstimatePriceDto): Promise<PriceEstimate> {
    const baseFee = BASE_FEE;
    const sizeFee = SIZE_FEES[dto.packageSize] ?? 0;
    const weightFee = round2(dto.packageWeight * WEIGHT_RATE);
    const typeFee = dto.packageTypes.reduce(
      (sum, type) => sum + (TYPE_SURCHARGES[type] ?? 0),
      0,
    );

    const distanceKm = await this.resolveDistanceKm(dto);
    const distanceFee = round2(distanceKm * PER_KM_RATE);

    const total = round2(
      baseFee + sizeFee + weightFee + typeFee + distanceFee,
    );

    return {
      baseFee,
      sizeFee,
      weightFee,
      typeFee,
      distanceKm: round2(distanceKm),
      distanceFee,
      total,
    };
  }

  /**
   * Resolves the flight distance. Prefers caller-supplied coordinates; falls
   * back to geocoding the addresses. Returns 0 when neither is available (so
   * pricing degrades gracefully to the size/weight/type model).
   */
  private async resolveDistanceKm(dto: EstimatePriceDto): Promise<number> {
    let { fromLat, fromLng, toLat, toLng } = dto;

    if ((fromLat == null || fromLng == null) && dto.fromAddress) {
      const geo = await this.geoService.geocode(dto.fromAddress);
      if (geo) {
        fromLat = geo.lat;
        fromLng = geo.lng;
      }
    }
    if ((toLat == null || toLng == null) && dto.toAddress) {
      const geo = await this.geoService.geocode(dto.toAddress);
      if (geo) {
        toLat = geo.lat;
        toLng = geo.lng;
      }
    }

    if (
      fromLat == null ||
      fromLng == null ||
      toLat == null ||
      toLng == null
    ) {
      return 0;
    }

    return haversineKm(fromLat, fromLng, toLat, toLng);
  }
}
