import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  Prisma,
  Role,
  SupportTicketStatus,
} from '@prisma/client';

import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/exceptions/app-exception';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DroneCommandService } from '../deliveries/commands/drone-command.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SupportChatPublisher,
  toSupportChatPayload,
} from '../support/chat/support-chat.publisher';
import { WalletService } from '../wallet/wallet.service';
import {
  AdminDeliveryQueryDto,
  AdminTicketQueryDto,
  AdminUserQueryDto,
  CreatePromoDto,
  IssueCommandDto,
  UpdatePromoDto,
} from './dto/admin.dto';

const USER_SELECT = { id: true, name: true, email: true } as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
    private readonly walletService: WalletService,
    private readonly chatPublisher: SupportChatPublisher,
    private readonly droneCommands: DroneCommandService,
  ) {}

  // ── Support inbox (AGENT + ADMIN) ──

  async listTickets(query: AdminTicketQueryDto) {
    const where = query.status ? { status: query.status } : {};
    // Operator reporting list — lag-tolerant → read replica (one consistent
    // snapshot via the reader's $transaction; falls back to primary).
    const [items, total] = await this.prisma.readWithFallback((c) =>
      c.$transaction([
        c.supportTicket.findMany({
          where,
          orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
          skip: query.skip,
          take: query.limit,
          include: { user: { select: USER_SELECT } },
        }),
        c.supportTicket.count({ where }),
      ]),
    );
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: USER_SELECT },
        messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!ticket)
      throw new AppNotFoundException('error.admin.ticket.not_found', { id });
    return ticket;
  }

  /** Reply as an agent: persist an AGENT message (attributed to the agent),
   * bump recency, auto-advance OPEN→IN_PROGRESS, and fan out to the user live. */
  async replyAsAgent(agentId: string, ticketId: string, content: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });
    if (!ticket)
      throw new AppNotFoundException('error.admin.ticket.not_found', {
        id: ticketId,
      });
    if (ticket.status === 'CLOSED') {
      throw new AppConflictException('error.admin.ticket.closed');
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({
        data: {
          ticketId,
          senderRole: 'AGENT',
          senderUserId: agentId, // attribution (audit); client renders by senderRole
          content,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: new Date(),
          status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
        },
      }),
    ]);

    const payload = toSupportChatPayload(message);
    await this.chatPublisher.publishMessage(payload); // realtime to the user
    this.logger.log(`agent ${agentId} replied to ticket ${ticketId}`);
    return payload;
  }

  async setTicketStatus(ticketId: string, status: SupportTicketStatus) {
    const { count } = await this.prisma.supportTicket.updateMany({
      where: { id: ticketId },
      data: { status },
    });
    if (count === 0)
      throw new AppNotFoundException('error.admin.ticket.not_found', {
        id: ticketId,
      });
    this.logger.log(`ticket ${ticketId} status → ${status}`);
    return this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
  }

  // ── Delivery oversight (ADMIN) ──

  async listDeliveries(query: AdminDeliveryQueryDto) {
    const where: Prisma.DeliveryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [items, total] = await this.prisma.readWithFallback((c) =>
      c.$transaction([
        c.delivery.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: query.skip,
          take: query.limit,
          include: { user: { select: USER_SELECT }, payment: true },
        }),
        c.delivery.count({ where }),
      ]),
    );
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getDelivery(id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id },
      include: {
        user: { select: USER_SELECT },
        tracking: true,
        payment: true,
        proofOfDelivery: true,
        rating: true,
      },
    });
    if (!delivery)
      throw new AppNotFoundException('error.delivery.not_found', { id });
    return delivery;
  }

  forceCancel(deliveryId: string) {
    return this.deliveries.adminForceCancel(deliveryId);
  }

  /** Fail an in-flight delivery as a first-class exception (default ADMIN_ABORT,
   * a drone-fault reason → refunds the customer). 404/409 like force-cancel. */
  fail(deliveryId: string, reason?: DeliveryFailureReason) {
    return this.deliveries.adminFail(
      deliveryId,
      reason ?? DeliveryFailureReason.ADMIN_ABORT,
    );
  }

  /** Goodwill refund as a wallet credit (Stripe has no refund integration). Idempotent
   * via the `admin-refund:<id>` key; marks the Payment REFUNDED for bookkeeping. */
  async refund(deliveryId: string, amount?: number) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { userId: true, estimatedPrice: true },
    });
    if (!delivery)
      throw new AppNotFoundException('error.delivery.not_found', {
        id: deliveryId,
      });

    const refundAmount = amount ?? delivery.estimatedPrice;
    if (refundAmount <= 0 || refundAmount > delivery.estimatedPrice) {
      throw new AppBadRequestException('error.admin.refund.invalid_amount');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Single-winner gate so the card charge is refunded AT MOST ONCE across channels: flip
        // the Payment to REFUNDED only if it isn't already, and credit the wallet only when
        // that flip won. Without this, the automatic drone-fault refund
        // (WalletService.refundChargeToWallet, keyed `exception-refund:<id>`) and this goodwill
        // refund (keyed `admin-refund:<id>`) use mutually-blind idempotency keys and both credit
        // the same delivery — a double refund.
        const { count } = await tx.payment.updateMany({
          where: { deliveryId, status: { not: 'REFUNDED' } },
          data: { status: 'REFUNDED' },
        });
        if (count === 0) {
          throw new AppConflictException('error.admin.refund.already_refunded');
        }
        await this.walletService.creditWithinTx(
          tx,
          delivery.userId,
          refundAmount,
          'CHECKOUT_REFUND',
          { deliveryId, idempotencyKey: `admin-refund:${deliveryId}` },
        );
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppConflictException('error.admin.refund.already_refunded');
      }
      throw e;
    }
    this.logger.log(
      `admin refunded ${refundAmount} for delivery ${deliveryId}`,
    );
    return { deliveryId, refunded: refundAmount };
  }

  // ── Drone commands (backend → drone) ──

  /** Issue a backend→drone command (RETURN_TO_BASE / ABORT) on a LIVE delivery.
   * The delivery transitions only when the drone acks. 404/422/409 from the service. */
  issueDroneCommand(adminId: string, deliveryId: string, dto: IssueCommandDto) {
    return this.droneCommands.issue(adminId, deliveryId, dto);
  }

  /** Command audit history for a delivery (newest first). 404 if the delivery is missing. */
  listDroneCommands(deliveryId: string) {
    return this.droneCommands.listForDelivery(deliveryId);
  }

  // ── Promo CRUD (ADMIN) ──

  async createPromo(dto: CreatePromoDto) {
    this.assertDiscountValue(dto.discountType, dto.discountValue);
    try {
      return await this.prisma.promoCode.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          description: dto.description ?? null,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minOrderTotal: dto.minOrderTotal ?? 0,
          maxDiscount: dto.maxDiscount ?? null,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppConflictException('error.admin.promo.code_exists');
      }
      throw e;
    }
  }

  async listPromos(query: { skip: number; limit?: number; page?: number }) {
    const [items, total] = await this.prisma.readWithFallback((c) =>
      c.$transaction([
        c.promoCode.findMany({
          orderBy: { createdAt: 'desc' },
          skip: query.skip,
          take: query.limit,
        }),
        c.promoCode.count(),
      ]),
    );
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getPromo(id: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo)
      throw new AppNotFoundException('error.admin.promo.not_found', { id });
    return promo;
  }

  async updatePromo(id: string, dto: UpdatePromoDto) {
    const existing = await this.getPromo(id); // 404 if missing
    // Update can change discountValue but NOT discountType — so validate the new value
    // against the EXISTING type (createPromo enforces this; update must too, or a PERCENT
    // promo could be PATCHed to >100%).
    if (dto.discountValue !== undefined) {
      this.assertDiscountValue(existing.discountType, dto.discountValue);
    }
    const { count } = await this.prisma.promoCode.updateMany({
      where: { id },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.discountValue !== undefined
          ? { discountValue: dto.discountValue }
          : {}),
        ...(dto.minOrderTotal !== undefined
          ? { minOrderTotal: dto.minOrderTotal }
          : {}),
        ...(dto.maxDiscount !== undefined
          ? { maxDiscount: dto.maxDiscount }
          : {}),
        ...(dto.endsAt !== undefined ? { endsAt: new Date(dto.endsAt) } : {}),
        ...(dto.maxRedemptions !== undefined
          ? { maxRedemptions: dto.maxRedemptions }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    if (count === 0)
      throw new AppNotFoundException('error.admin.promo.not_found', { id });
    return this.prisma.promoCode.findUnique({ where: { id } });
  }

  private assertDiscountValue(type: string, value: number) {
    if (type === 'PERCENT' && (value <= 0 || value > 100)) {
      throw new AppBadRequestException('error.admin.promo.percent_range');
    }
  }

  // ── Overview (ADMIN) ──

  async getOverview() {
    const [users, byStatus, revenue, openTickets, activeRecurring] =
      await this.prisma.readWithFallback((c) =>
        c.$transaction([
          c.user.count(),
          c.delivery.groupBy({
            by: ['status'],
            _count: { _all: true },
            orderBy: { status: 'asc' },
          }),
          c.payment.aggregate({
            _sum: { amount: true },
            where: { status: 'COMPLETED' },
          }),
          c.supportTicket.count({
            where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          }),
          c.recurringDelivery.count({ where: { active: true } }),
        ]),
      );

    // Backfill every status to 0 so the dashboard shape is stable.
    const deliveriesByStatus: Record<string, number> = {};
    for (const s of Object.values(DeliveryStatus)) deliveriesByStatus[s] = 0;
    for (const row of byStatus as Array<{
      status: string;
      _count: { _all: number };
    }>) {
      deliveriesByStatus[row.status] = row._count._all;
    }

    return {
      users,
      deliveriesByStatus,
      revenue: Math.round((revenue._sum.amount ?? 0) * 100) / 100,
      openTickets,
      activeRecurringSchedules: activeRecurring,
    };
  }

  // ── Users / roles (ADMIN) ──

  async listUsers(query: AdminUserQueryDto) {
    const where = query.role ? { role: query.role } : {};
    const [items, total] = await this.prisma.readWithFallback((c) =>
      c.$transaction([
        c.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: query.skip,
          take: query.limit,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
        }),
        c.user.count({ where }),
      ]),
    );
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async setRole(actingAdminId: string, targetId: string, role: Role) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target)
      throw new AppNotFoundException('error.admin.user.not_found', {
        id: targetId,
      });

    // Don't strand the system with zero admins.
    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) {
        throw new AppConflictException('error.admin.user.last_admin');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: { id: true, email: true, role: true },
    });
    this.logger.log(`admin ${actingAdminId} set user ${targetId} role=${role}`);
    return updated;
  }
}
