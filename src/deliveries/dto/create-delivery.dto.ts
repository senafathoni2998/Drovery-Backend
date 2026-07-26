import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PACKAGE_SIZES, PACKAGE_TYPES } from '../../common/constants';

export class CreateDeliveryDto {
  @IsString()
  @IsNotEmpty()
  fromAddress: string;

  @IsString()
  @IsNotEmpty()
  toAddress: string;

  @IsString()
  @IsNotEmpty()
  receiver: string;

  @IsString()
  @IsNotEmpty()
  packages: string;

  @IsString()
  @IsIn([...PACKAGE_SIZES])
  packageSize: string;

  @IsNumber()
  @IsPositive()
  packageWeight: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn([...PACKAGE_TYPES], { each: true })
  packageTypes: string[];

  @IsString()
  @IsNotEmpty()
  pickupDate: string;

  @IsString()
  @IsNotEmpty()
  pickupTime: string;

  // Optional promo code applied to the price at checkout (validated + redeemed
  // atomically with delivery creation).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string;

  // Apply available wallet credits to the price (server-computed amount: as much
  // as the post-promo total, capped at the balance).
  @IsOptional()
  @IsBoolean()
  useCredits?: boolean;

  // Advisory only. The server geocodes fromAddress/toAddress and prices from THAT;
  // these are validated against the geocode (see DeliveriesService.resolveCoords)
  // and rejected if they disagree, but never used for distance or serviceability.
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  fromLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  fromLng?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  toLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  toLng?: number;

  // Who drives this delivery's lifecycle. Omitted/SIMULATED (default) runs the
  // in-memory simulation as before; LIVE starts no simulation and is driven
  // entirely by real drone telemetry via /ingest/telemetry.
  @IsOptional()
  @IsIn(['SIMULATED', 'LIVE'])
  trackingSource?: 'SIMULATED' | 'LIVE';

  // The drone bound to a LIVE delivery (telemetry must report this id). Defaults
  // to a deterministic id derived from the tracking id when omitted.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  droneId?: string;
}
