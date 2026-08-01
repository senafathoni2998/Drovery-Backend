import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
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
  //
  // NOTE: this is the PUBLIC quote endpoint, where a caller who lies to themselves
  // only gets a wrong quote — no money moves. The authoritative price is computed in
  // DeliveriesService.create(), which ignores caller coords entirely and prices from
  // the server-side geocode. Do not "optimise" create() to trust these.
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
}
