import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSavedAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address: string;

  // Optional client-supplied coords (WGS84 bounds); geocoded from the address
  // when absent. Bounded so garbage coords can't reach distance/serviceability.
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

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
