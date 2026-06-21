import { ApiProperty } from '@nestjs/swagger';
import {
  DeliveryFailureReason,
  DroneCommandStatus,
  DroneCommandType,
  PromoDiscountType,
  Role,
  SupportTicketStatus,
} from '@prisma/client';

import {
  DeliveryResponseDto,
  PaymentSummaryDto,
} from '../../deliveries/dto/delivery-response.dto';
import { SupportChatMessageDto } from '../../support/dto/support-response.dto';

// ── Overview ──────────────────────────────────────────────────────────────────

export class AdminOverviewDto {
  /** Total registered user count. */
  users: number;
  /** Delivery count per status (every DeliveryStatus key is present, defaulting to 0). */
  deliveriesByStatus: Record<string, number>;
  /** Sum of all COMPLETED payment amounts (dollars, 2 dp). */
  revenue: number;
  /** Support tickets currently OPEN or IN_PROGRESS. */
  openTickets: number;
  /** Active recurring delivery schedules. */
  activeRecurringSchedules: number;
}

// ── Admin deliveries ───────────────────────────────────────────────────────────

/** Minimal user summary embedded in admin delivery rows. */
export class AdminDeliveryUserDto {
  id: string;
  name: string;
  email: string;
}

/**
 * Delivery row as returned by the admin delivery endpoints. Extends the standard
 * delivery shape with an embedded user summary and payment.
 * handoffCodeHash + handoffAttempts are globally omitted by PrismaService.
 *
 * `user` is present on the list/detail READS (which include the user relation)
 * but ABSENT on the force-cancel / fail mutations (which include only
 * tracking + payment) — hence optional.
 */
export class AdminDeliveryResponseDto extends DeliveryResponseDto {
  user?: AdminDeliveryUserDto | null;
  /** Payment row is always included on admin reads. */
  declare payment?: PaymentSummaryDto | null;
}

export class AdminPaginatedDeliveriesDto {
  @ApiProperty({ type: [AdminDeliveryResponseDto] })
  items: AdminDeliveryResponseDto[];
  total: number;
  page: number;
  limit: number;
}

// ── Refund ────────────────────────────────────────────────────────────────────

export class AdminRefundResponseDto {
  deliveryId: string;
  /** Dollar amount credited back to the customer's wallet. */
  refunded: number;
}

// ── Drone commands ────────────────────────────────────────────────────────────

/**
 * Full DroneCommand record returned by issue/list endpoints.
 * issuedByUserId is included for operator audit; internal fields (delivery FK
 * relation object) are not surfaced.
 */
export class DroneCommandResponseDto {
  id: string;
  deliveryId: string;
  /** The drone this command targets (denormalized from delivery.assignedDroneId at issue time). */
  droneId: string;
  @ApiProperty({ enum: DroneCommandType })
  type: DroneCommandType;
  @ApiProperty({ enum: DeliveryFailureReason })
  reason: DeliveryFailureReason;
  @ApiProperty({ enum: DroneCommandStatus })
  status: DroneCommandStatus;
  /** Admin user who issued this command (null if that user was later deleted). */
  issuedByUserId: string | null;
  /** Whether this command's ack successfully applied the delivery transition. */
  appliedTransition: boolean;
  resultNote: string | null;
  /** Command expires at this instant; unacked commands past this never execute. */
  expiresAt: Date;
  fetchedAt: Date | null;
  ackedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Promo codes ───────────────────────────────────────────────────────────────

export class PromoResponseDto {
  id: string;
  /** Stored UPPERCASE. */
  code: string;
  description: string | null;
  @ApiProperty({ enum: PromoDiscountType })
  discountType: PromoDiscountType;
  /** PERCENT: whole percent (0–100); FIXED: dollars (> 0). */
  discountValue: number;
  /** Minimum pre-discount order total to qualify; 0 = no gate. */
  minOrderTotal: number;
  /** Caps the dollar discount (mainly for PERCENT codes); null = uncapped. */
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  perUserLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

export class AdminPaginatedPromosDto {
  @ApiProperty({ type: [PromoResponseDto] })
  items: PromoResponseDto[];
  total: number;
  page: number;
  limit: number;
}

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * Lightweight user row returned by the admin user list.
 * Omits sensitive columns: passwordHash, stripeCustomerId, creditBalance,
 * referralCode, phone, address, bio, avatarUrl.
 */
export class AdminUserListItemDto {
  id: string;
  name: string;
  email: string;
  @ApiProperty({ enum: Role })
  role: Role;
  createdAt: Date;
}

export class AdminPaginatedUsersDto {
  @ApiProperty({ type: [AdminUserListItemDto] })
  items: AdminUserListItemDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Projection returned by setRole: id, email, and the newly applied role.
 * Omits all other user columns.
 */
export class AdminUserRoleDto {
  id: string;
  email: string;
  @ApiProperty({ enum: Role })
  role: Role;
}

// ── Support tickets (AGENT + ADMIN inbox) ────────────────────────────────────

/** Minimal user summary embedded in admin support-ticket rows. */
export class AdminTicketUserDto {
  id: string;
  name: string;
  email: string;
}

/**
 * Support ticket row as returned by the admin ticket list.
 * Includes an embedded user summary (id, name, email).
 */
export class AdminSupportTicketListItemDto {
  id: string;
  userId: string;
  /** The opening message text — kept for mobile ticket-list display. */
  message: string;
  @ApiProperty({ enum: SupportTicketStatus })
  status: SupportTicketStatus;
  /** Timestamp of the most recent message; drives "active first" ordering. */
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: AdminTicketUserDto;
}

export class AdminPaginatedSupportTicketsDto {
  @ApiProperty({ type: [AdminSupportTicketListItemDto] })
  items: AdminSupportTicketListItemDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Full support ticket with user and message thread — returned by the
 * single-ticket detail endpoint (GET /admin/support/tickets/:id).
 */
export class AdminSupportTicketDetailDto {
  id: string;
  userId: string;
  /** The opening message text. */
  message: string;
  @ApiProperty({ enum: SupportTicketStatus })
  status: SupportTicketStatus;
  /** Timestamp of the most recent message; drives "active first" ordering. */
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: AdminTicketUserDto;
  @ApiProperty({ type: [SupportChatMessageDto] })
  messages: SupportChatMessageDto[];
}

/**
 * Bare support ticket row returned by PATCH status — no relations.
 * Shape is the Prisma SupportTicket scalar columns only.
 */
export class AdminSupportTicketStatusDto {
  id: string;
  userId: string;
  message: string;
  @ApiProperty({ enum: SupportTicketStatus })
  status: SupportTicketStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
