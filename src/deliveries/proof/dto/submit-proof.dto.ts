import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SubmitProofDto {
  // base64 image or a data: URL (optional — a placeholder is used if omitted)
  @IsOptional()
  @IsString()
  @MaxLength(10_000_000)
  photoBase64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
