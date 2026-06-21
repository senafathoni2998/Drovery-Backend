export interface GeoCircle {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export type ServiceArea = GeoCircle;
export type NoFlyZone = GeoCircle;

export interface RouteSegment {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

/** Machine-parseable reasons a route can't be flown. */
export type ServiceabilityCode =
  | 'OUT_OF_AREA' // pickup/dropoff outside the service area (hard, non-retryable)
  | 'NO_FLY_ZONE' // endpoint or route crosses restricted airspace (hard)
  | 'WEATHER_HOLD' // high wind / rain grounding drones (soft, retryable)
  | 'WEATHER_STORM'; // severe weather (soft, retryable)

export interface ServiceabilityResult {
  serviceable: boolean;
  reasons: string[]; // human-readable (English; kept as machine/debug passthrough)
  codes: ServiceabilityCode[]; // machine
  weatherHold: boolean; // true iff any code is a WEATHER_* (transient → retryable)
  // Interpolation params for the blocking reason's localized message ({zoneName} for
  // NO_FLY_ZONE, {windKph} for WEATHER_HOLD), so the boundary can translate per-code.
  params?: Record<string, string | number>;
}
