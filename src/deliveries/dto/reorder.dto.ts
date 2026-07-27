import { IsOptional, IsString, Matches } from 'class-validator';

import { PICKUP_DATE_RE, PICKUP_TIME_RE } from './../delivery-schedule';

// Optional pickup override for a reorder; both omitted → immediate (now).
export class ReorderDto {
  @IsOptional()
  @IsString()
  @Matches(PICKUP_DATE_RE, { message: 'pickupDate must be YYYY-MM-DD' })
  pickupDate?: string;

  @IsOptional()
  @IsString()
  @Matches(PICKUP_TIME_RE, { message: 'pickupTime must be 24-hour HH:MM' })
  pickupTime?: string;
}
