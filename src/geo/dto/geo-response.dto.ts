import { ApiProperty } from '@nestjs/swagger';

/**
 * Lat/lng pair returned by the geocode endpoint.
 * The CLI plugin infers `lat` and `lng` as `number` from their TS types.
 */
export class GeoCoordinatesDto {
  /** WGS-84 latitude in decimal degrees. */
  @ApiProperty({ description: 'WGS-84 latitude in decimal degrees' })
  lat: number;

  /** WGS-84 longitude in decimal degrees. */
  @ApiProperty({ description: 'WGS-84 longitude in decimal degrees' })
  lng: number;
}

/**
 * Response shape for GET /geo/geocode.
 * The handler manually wraps its result in { data } before the
 * TransformInterceptor adds the outer { success, data, timestamp } envelope,
 * so the documented shape includes the inner `data` field.
 * `data` is null when the address cannot be resolved.
 */
export class GeocodeResponseDto {
  @ApiProperty({
    type: GeoCoordinatesDto,
    nullable: true,
    description: 'Resolved coordinates, or null if the address was not found.',
  })
  data: GeoCoordinatesDto | null;
}

/**
 * Response shape for GET /geo/reverse.
 * Same manual inner-wrapping pattern as GeocodeResponseDto.
 * `data` is null when the coordinates cannot be reverse-geocoded.
 */
export class ReverseGeocodeResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Human-readable address string, or null if the coordinates could not be resolved.',
  })
  data: string | null;
}
