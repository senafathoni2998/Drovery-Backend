import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AirspaceZoneKind } from '@prisma/client';

/** A zone bigger than this is almost certainly a units error, and would ground a region. */
export const MAX_ZONE_RADIUS_KM = 500;

export class CreateAirspaceZoneDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;

  @IsEnum(AirspaceZoneKind) kind: AirspaceZoneKind;

  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;

  @IsNumber() @IsPositive() @Max(MAX_ZONE_RADIUS_KM) radiusKm: number;

  @IsOptional() @IsInt() @Min(0) floorM?: number;
  @IsOptional() @IsInt() @Min(0) ceilingM?: number;

  @IsOptional() @IsDateString() activeFrom?: string;
  @IsOptional() @IsDateString() activeUntil?: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateAirspaceZoneDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(AirspaceZoneKind) kind?: AirspaceZoneKind;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_ZONE_RADIUS_KM)
  radiusKm?: number;
  @IsOptional() @IsInt() @Min(0) floorM?: number;
  @IsOptional() @IsInt() @Min(0) ceilingM?: number;
  @IsOptional() @IsDateString() activeFrom?: string;
  @IsOptional() @IsDateString() activeUntil?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
