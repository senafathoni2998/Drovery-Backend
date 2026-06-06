import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

import { PACKAGE_SIZES } from '../../common/constants';

export class EstimatePriceDto {
  @IsString()
  @IsOptional()
  fromAddress?: string;

  @IsString()
  @IsOptional()
  toAddress?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...PACKAGE_SIZES])
  packageSize: string;

  @IsNumber()
  @IsPositive()
  packageWeight: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  packageTypes: string[];

  // Optional coordinates — when supplied, used directly for distance pricing
  // (avoids a geocoding round-trip).
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
