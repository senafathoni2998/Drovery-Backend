import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFavoriteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string;

  // The past delivery to snapshot as a reusable template.
  @IsString()
  @IsNotEmpty()
  deliveryId: string;
}

// Optional pickup override when ordering from a favorite; omitted → immediate.
export class OrderFavoriteDto {
  @IsOptional()
  @IsString()
  pickupDate?: string;

  @IsOptional()
  @IsString()
  pickupTime?: string;
}
