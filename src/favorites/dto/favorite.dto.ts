import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  PICKUP_DATE_RE,
  PICKUP_TIME_RE,
} from '../../deliveries/delivery-schedule';

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
  @Matches(PICKUP_DATE_RE, { message: 'pickupDate must be YYYY-MM-DD' })
  pickupDate?: string;

  @IsOptional()
  @IsString()
  @Matches(PICKUP_TIME_RE, { message: 'pickupTime must be 24-hour HH:MM' })
  pickupTime?: string;
}
