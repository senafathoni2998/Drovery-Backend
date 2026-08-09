export interface GeoCircle {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export type ServiceArea = GeoCircle;
// NoFlyZone was an alias for GeoCircle, used only by the deleted NO_FLY_ZONES constant.
// Zones now come from the database as plain GeoCircles (AirspaceService.inForceZones).

export interface RouteSegment {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

/** Machine-parseable reasons a route can't be flown. */
export type ServiceabilityCode =
  | 'OUT_OF_AREA' // pickup/dropoff outside the service area (hard, non-retryable)
  | 'ROUTE_TOO_LONG' // farther than any drone can fly (hard, non-retryable)
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
  /**
   * PRESENTATION ONLY — overrides the `error.serviceability.<CODE>` key the boundary
   * would otherwise derive, leaving `codes` untouched.
   *
   * Exists for one case: two situations share the NO_FLY_ZONE code but not a sentence.
   * "Your route crosses X" names a zone; "we could not read the zone list" has no zone
   * to name, and the NO_FLY_ZONE template interpolates {zoneName}. Setting this is how
   * a blocker says "same code, different sentence" without minting a code that clients
   * would have to learn. See serviceability.service.ts's fail-closed catch.
   */
  messageKey?: string;
}
