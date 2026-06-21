import { RecurrenceFreq } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { PACKAGE_SIZES, PACKAGE_TYPES } from '../../common/constants';

export class CreateRecurringDeliveryDto {
  // ── recurrence rule ──
  @IsEnum(RecurrenceFreq)
  freq: RecurrenceFreq;

  // WEEKLY only (0=Sun..6=Sat); required for WEEKLY, ignored for DAILY (enforced in the service).
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'timeOfDay must be HH:MM (24-hour)',
  })
  timeOfDay: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // ── delivery template (same validators as CreateDeliveryDto, minus pickupDate) ──
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
