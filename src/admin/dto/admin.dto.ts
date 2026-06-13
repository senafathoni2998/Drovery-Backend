import {
  DeliveryStatus,
  PromoDiscountType,
  Role,
  SupportTicketStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
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
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class SetRoleDto {
  @IsEnum(Role)
  role: Role;
}
