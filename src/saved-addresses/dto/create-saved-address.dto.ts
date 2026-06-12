import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
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

  // Optional client-supplied coords; geocoded from the address when absent.
  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
