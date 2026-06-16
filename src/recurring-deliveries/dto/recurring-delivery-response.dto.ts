import { ApiProperty } from '@nestjs/swagger';
import { RecurrenceFreq } from '@prisma/client';

// Response DTOs for the recurring-deliveries feature. Field types are inferred
// by the @nestjs/swagger CLI plugin at `nest build`. @ApiProperty is only used
// for enums and descriptions that add real documentation value.

export class RecurringDeliveryResponseDto {
  id: string;
  userId: string;

  @ApiProperty({ enum: RecurrenceFreq })
  freq: RecurrenceFreq;

  /** Day-of-week indices (0=Sun..6=Sat). Non-empty for WEEKLY, always empty for DAILY. */
  @ApiProperty({
    type: [Number],
    description:
      'Day-of-week indices (0=Sun..6=Sat). Non-empty for WEEKLY, empty for DAILY.',
  })
  daysOfWeek: number[];

  /** Wall-clock time in "HH:MM" 24h format. */
  timeOfDay: string;

  startDate: Date;
  endDate: Date | null;

  /** Whether the schedule is active; false means paused. */
  active: boolean;

  /** Next scheduled occurrence to be materialized; null once the schedule is exhausted. */
  nextRunAt: Date | null;

  lastMaterializedAt: Date | null;

  /** ID of the most recently materialized Delivery (provenance only). */
  lastDeliveryId: string | null;

  fromAddress: string;
  toAddress: string;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;

  receiver: string;
  packages: string;
  packageSize: string;
  packageWeight: number;
  packageTypes: string[];

  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedRecurringDeliveriesDto {
  @ApiProperty({ type: [RecurringDeliveryResponseDto] })
  items: RecurringDeliveryResponseDto[];

  total: number;
  page: number;
  limit: number;
}
