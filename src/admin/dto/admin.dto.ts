import {
  DeliveryFailureReason,
  DeliveryStatus,
  DroneCommandType,
  DroneStatus,
  PromoDiscountType,
  Role,
  SupportTicketStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationDto } from '../../common/dto/pagination.dto';

// ── Support inbox ──
export class AdminTicketQueryDto extends PaginationDto {
  /**
   * Free-text search. The console had NO search anywhere — every list was
   * page + limit + one enum — so an agent with a customer on the phone quoting a
   * tracking id had to page through 20 rows at a time. Case-insensitive contains.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;
}

export class AgentReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class TicketStatusDto {
  @IsEnum(SupportTicketStatus)
  status: SupportTicketStatus;
}

// ── Delivery oversight ──
export class AdminDeliveryQueryDto extends PaginationDto {
  /**
   * Free-text search. The console had NO search anywhere — every list was
   * page + limit + one enum — so an agent with a customer on the phone quoting a
   * tracking id had to page through 20 rows at a time. Case-insensitive contains.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class RefundDto {
  // Optional partial-refund amount in dollars; default = the charged total.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;
}

export class FailDeliveryDto {
  // Why the delivery is being failed; defaults to ADMIN_ABORT (a drone-fault
  // reason → refunds the customer) when omitted.
  @IsOptional()
  @IsEnum(DeliveryFailureReason)
  reason?: DeliveryFailureReason;
}

// ── Drone commands (backend → drone) ──
export class IssueCommandDto {
  // RETURN_TO_BASE (→ RETURNING) or ABORT (→ DELIVERY_FAILED).
  @IsEnum(DroneCommandType)
  type: DroneCommandType;

  // Override the fault reason stamped on the delivery; defaults per type
  // (RETURN_TO_BASE → WEATHER_ABORT, ABORT → ADMIN_ABORT, both drone-fault →
  // refund). Pass RECIPIENT_UNAVAILABLE for a non-refunding operator outcome.
  @IsOptional()
  @IsEnum(DeliveryFailureReason)
  reason?: DeliveryFailureReason;
}

// ── Promo CRUD ──
export class CreatePromoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsEnum(PromoDiscountType)
  discountType: PromoDiscountType;

  @IsNumber()
  @IsPositive()
  discountValue: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderTotal?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDiscount?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;
}

export class UpdatePromoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderTotal?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDiscount?: number;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @Type(() => Boolean)
  active?: boolean;
}

// ── Users / roles ──
export class AdminUserQueryDto extends PaginationDto {
  /**
   * Free-text search. The console had NO search anywhere — every list was
   * page + limit + one enum — so an agent with a customer on the phone quoting a
   * tracking id had to page through 20 rows at a time. Case-insensitive contains.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class SetRoleDto {
  @IsEnum(Role)
  role: Role;
}

// ── Fleet ──

export class AdminDroneQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(DroneStatus)
  status?: DroneStatus;

  /** Free-text over serial and model. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

/**
 * Registering a real aircraft. Payload class and home base are REQUIRED because
 * dispatch reasons about both — an aircraft with unknown capability is one that can
 * never be safely claimed, which is exactly the state the backfilled legacy rows are
 * parked in.
 */
export class CreateDroneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  serial: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  model: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  firmwareVersion?: string;

  @IsNumber()
  @IsPositive()
  maxPayloadKg: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  homeBaseLat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  homeBaseLng: number;
}

/** Everything an operator can change after registration. */
export class UpdateDroneDto {
  @IsOptional()
  @IsEnum(DroneStatus)
  status?: DroneStatus;

  /** Ground an airframe after an incident or a lapsed inspection. */
  @IsOptional()
  @IsBoolean()
  airworthy?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  firmwareVersion?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxPayloadKg?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPercent?: number;

  @IsOptional()
  @IsDateString()
  maintenanceDueAt?: string;
}
