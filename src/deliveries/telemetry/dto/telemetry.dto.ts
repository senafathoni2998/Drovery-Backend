import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DeliveryFailureReason } from '@prisma/client';

import {
  AIRSPEED_MAX_KPH,
  ALTITUDE_MAX_M,
  ALTITUDE_MIN_M,
  DRONE_PHASES,
} from '../telemetry.constants';
import type { DronePhase } from '../telemetry.constants';

/**
 * One telemetry frame from a drone-gateway. The global ValidationPipe
 * (whitelist + forbidNonWhitelisted) rejects any unknown field with 400, so a
 * malformed/extra-field message never reaches the ingest core. lat/lng are
 * bounds-checked here; the service enforces they're provided together.
 */
export class TelemetryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deliveryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  droneId: string;

  @IsOptional()
  @IsIn(DRONE_PHASES)
  phase?: DronePhase;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  /**
   * Altitude above mean sea level, metres. Bounded well above any legal drone
   * ceiling and below sea level, so a garbage reading is rejected rather than
   * recorded into a flight log an incident review will later trust.
   */
  @IsOptional()
  @IsNumber()
  @Min(ALTITUDE_MIN_M)
  @Max(ALTITUDE_MAX_M)
  altitudeM?: number;

  /**
   * State of charge, whole percent. The single most consequential number a drone
   * transmits: it is what decides whether the aircraft is told to come home.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(AIRSPEED_MAX_KPH)
  airspeedKph?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  droneStatus?: string;

  @IsOptional()
  @IsISO8601()
  eta?: string;

  // Why the delivery failed/aborted — only meaningful for an exception phase
  // (FAILED/RETURNING). Ignored for happy-path frames.
  @IsOptional()
  @IsIn(Object.values(DeliveryFailureReason))
  failureReason?: DeliveryFailureReason;
}
