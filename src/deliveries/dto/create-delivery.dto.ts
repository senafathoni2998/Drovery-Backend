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
  MaxLength,
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

  @IsOptional()
  @IsNumber()
  fromLat?: number;

  @IsOptional()
  @IsNumber()
  fromLng?: number;

  @IsOptional()
  @IsNumber()
  toLat?: number;

  @IsOptional()
  @IsNumber()
  toLng?: number;
}
