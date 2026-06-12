import { Injectable } from '@nestjs/common';

import { haversineKm } from '../common/geo-distance';
import { GeoService } from '../geo/geo.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { ServiceabilityResult } from '../serviceability/serviceability.types';
import { EstimatePriceDto } from './dto';

// Re-export so existing imports (`import { haversineKm } from './pricing.service'`)
// keep working. The implementation lives in common/ to avoid a Pricing⇄
// Serviceability import cycle (Serviceability needs the distance helper too).
export { haversineKm } from '../common/geo-distance';

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

export interface PriceEstimate {
  baseFee: number;
  sizeFee: number;
  weightFee: number;
  typeFee: number;
  distanceKm: number;
  distanceFee: number;
  total: number;
  // Present only when all four coordinates resolve (advisory at quote time).
  serviceability?: ServiceabilityResult;
}

interface ResolvedCoords {
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly geoService: GeoService,
    private readonly serviceabilityService: ServiceabilityService,
  ) {}

  async estimate(dto: EstimatePriceDto): Promise<PriceEstimate> {
    const baseFee = BASE_FEE;
    const sizeFee = SIZE_FEES[dto.packageSize] ?? 0;
    const weightFee = round2(dto.packageWeight * WEIGHT_RATE);
    const typeFee = dto.packageTypes.reduce(
      (sum, type) => sum + (TYPE_SURCHARGES[type] ?? 0),
      0,
    );

    // Resolve coordinates ONCE (one geocode pass) for both distance + serviceability.
    const coords = await this.resolveCoords(dto);
    const distanceKm = this.distanceFromCoords(coords);
    const distanceFee = round2(distanceKm * PER_KM_RATE);

    const total = round2(
      baseFee + sizeFee + weightFee + typeFee + distanceFee,
    );

    const estimate: PriceEstimate = {
      baseFee,
      sizeFee,
      weightFee,
      typeFee,
      distanceKm: round2(distanceKm),
      distanceFee,
      total,
    };

    // Advisory serviceability — only when the full route is known. Never throws
    // (the quote endpoint is public + always 200); create() does the enforcement.
    if (this.hasFullRoute(coords)) {
      estimate.serviceability =
        await this.serviceabilityService.checkServiceability(
          coords.fromLat as number,
          coords.fromLng as number,
          coords.toLat as number,
          coords.toLng as number,
        );
    }

    return estimate;
  }

  /**
   * Resolves pickup/dropoff coordinates: prefers caller-supplied coords, falls
   * back to geocoding the addresses (best-effort — a missing pair stays undefined
   * so pricing/serviceability degrade gracefully).
   */
  async resolveCoords(dto: EstimatePriceDto): Promise<ResolvedCoords> {
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

    return { fromLat, fromLng, toLat, toLng };
  }

  private hasFullRoute(c: ResolvedCoords): boolean {
    return (
      c.fromLat != null &&
      c.fromLng != null &&
      c.toLat != null &&
      c.toLng != null
    );
  }

  private distanceFromCoords(c: ResolvedCoords): number {
    if (!this.hasFullRoute(c)) return 0;
    return haversineKm(
      c.fromLat as number,
      c.fromLng as number,
      c.toLat as number,
      c.toLng as number,
    );
  }
}
