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
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PACKAGE_SIZES, PACKAGE_TYPES } from '../../common/constants';
import { PICKUP_DATE_RE, PICKUP_TIME_RE } from '../delivery-schedule';

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

  // Wire format: YYYY-MM-DD. Unvalidated, a mismatch does not 400 — it silently
  // becomes an immediate dispatch. See delivery-schedule.ts.
  @IsString()
  @IsNotEmpty()
  @Matches(PICKUP_DATE_RE, { message: 'pickupDate must be YYYY-MM-DD' })
  pickupDate: string;

  // Wire format: 24-hour HH:MM. Same reason as pickupDate.
  @IsString()
  @IsNotEmpty()
  @Matches(PICKUP_TIME_RE, { message: 'pickupTime must be 24-hour HH:MM' })
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

  // NOTE: `trackingSource` and `droneId` used to live here, and both were
  // operator concerns sitting in a customer's request body. `trackingSource:
  // 'LIVE'` let any authenticated user declare their delivery real, and `droneId`
  // let them name the airframe that would fly it — which then became the MQTT
  // topic operator commands were published to.
  //
  // Both are now decided server-side by DispatchService: a deployment either
  // flies real aircraft or it does not (LIVE_DISPATCH), and the engine picks the
  // airframe that can actually complete the mission. See src/dispatch/.
}
