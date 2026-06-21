import { ApiProperty } from '@nestjs/swagger';

// Response DTOs for the pricing module. The @nestjs/swagger CLI plugin infers
// field schemas from TS types; @ApiProperty is only used where the plugin needs
// a hint (enums, arrays of objects, nullable descriptions).

/** Machine-parseable codes explaining why a route is non-serviceable. */
export type ServiceabilityCode =
  | 'OUT_OF_AREA'
  | 'NO_FLY_ZONE'
  | 'WEATHER_HOLD'
  | 'WEATHER_STORM';

/** Advisory serviceability check — present only when full pickup+dropoff coordinates are known. */
export class ServiceabilityResultDto {
  /** Whether the route can currently be flown end-to-end. */
  serviceable: boolean;
  /** Human-readable explanations (empty when serviceable). */
  @ApiProperty({ type: [String] })
  reasons: string[];
  /** Machine-parseable reason codes (empty when serviceable). */
  @ApiProperty({ type: [String] })
  codes: ServiceabilityCode[];
  /** True when any code is a transient weather hold (retryable). */
  weatherHold: boolean;
}

/** Full price breakdown returned by POST /pricing/estimate. */
export class PriceEstimateResponseDto {
  /** Flat base fee applied to every delivery. */
  baseFee: number;
  /** Additional fee based on package size tier. */
  sizeFee: number;
  /** Weight-based fee (rate × kg). */
  weightFee: number;
  /** Sum of per-type surcharges (fragile, electronics, food, healthcare). */
  typeFee: number;
  /** Great-circle distance between pickup and dropoff in kilometres. */
  distanceKm: number;
  /** Distance-based fee (rate × distanceKm). */
  distanceFee: number;
  /** Grand total (baseFee + sizeFee + weightFee + typeFee + distanceFee). */
  total: number;
  /** Advisory serviceability result — omitted when coordinates cannot be resolved. */
  serviceability?: ServiceabilityResultDto;
}
