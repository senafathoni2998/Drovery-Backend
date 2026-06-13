import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  Prisma,
  Role,
  SupportTicketStatus,
} from '@prisma/client';

import { DeliveriesService } from '../deliveries/deliveries.service';
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
  ) {}

  // ── Support inbox (AGENT + ADMIN) ──

  async listTickets(query: AdminTicketQueryDto) {
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.limit,
        include: { user: { select: USER_SELECT } },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
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
    if (!ticket) throw new NotFoundException(`Ticket "${id}" not found`);
    return ticket;
  }

  /** Reply as an agent: persist an AGENT message (attributed to the agent),
   * bump recency, auto-advance OPEN→IN_PROGRESS, and fan out to the user live. */
  async replyAsAgent(agentId: string, ticketId: string, content: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });
    if (!ticket) throw new NotFoundException(`Ticket "${ticketId}" not found`);
    if (ticket.status === 'CLOSED') {
      throw new ConflictException('This ticket is closed; reopen it first.');
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
    if (count === 0) throw new NotFoundException(`Ticket "${ticketId}" not found`);
    this.logger.log(`ticket ${ticketId} status → ${status}`);
    return this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
  }

  // ── Delivery oversight (ADMIN) ──

  async listDeliveries(query: AdminDeliveryQueryDto) {
    const where: Prisma.DeliveryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.delivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: { user: { select: USER_SELECT }, payment: true },
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getDelivery(id: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        user: { select: USER_SELECT },
        tracking: true,
        payment: true,
        proofOfDelivery: true,
        rating: true,
      },
    });
    if (!delivery) throw new NotFoundException(`Delivery "${id}" not found`);
    return delivery;
  }

  forceCancel(deliveryId: string) {
    return this.deliveries.adminForceCancel(deliveryId);
  }

  /** Goodwill refund as a wallet credit (Stripe has no refund integration). Idempotent
   * via the `admin-refund:<id>` key; marks the Payment REFUNDED for bookkeeping. */
  async refund(deliveryId: string, amount?: number) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { userId: true, estimatedPrice: true },
    });
    if (!delivery) throw new NotFoundException(`Delivery "${deliveryId}" not found`);

    const refundAmount = amount ?? delivery.estimatedPrice;
    if (refundAmount <= 0 || refundAmount > delivery.estimatedPrice) {
      throw new BadRequestException(
        'Refund must be greater than 0 and at most the charged total.',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.walletService.creditWithinTx(
          tx,
          delivery.userId,
          refundAmount,
          'CHECKOUT_REFUND',
          { deliveryId, idempotencyKey: `admin-refund:${deliveryId}` },
        );
        await tx.payment.updateMany({
          where: { deliveryId },
          data: { status: 'REFUNDED' },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This delivery has already been refunded.');
      }
      throw e;
    }
    this.logger.log(`admin refunded ${refundAmount} for delivery ${deliveryId}`);
    return { deliveryId, refunded: refundAmount };
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
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A promo code with that code already exists.');
      }
      throw e;
    }
  }

  async listPromos(query: { skip: number; limit?: number; page?: number }) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.promoCode.findMany({
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.promoCode.count(),
    ]);
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getPromo(id: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException(`Promo "${id}" not found`);
    return promo;
  }

  async updatePromo(id: string, dto: UpdatePromoDto) {
    await this.getPromo(id); // 404 if missing
    const { count } = await this.prisma.promoCode.updateMany({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.discountValue !== undefined
          ? { discountValue: dto.discountValue }
          : {}),
        ...(dto.minOrderTotal !== undefined
          ? { minOrderTotal: dto.minOrderTotal }
          : {}),
        ...(dto.maxDiscount !== undefined ? { maxDiscount: dto.maxDiscount } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: new Date(dto.endsAt) } : {}),
        ...(dto.maxRedemptions !== undefined
          ? { maxRedemptions: dto.maxRedemptions }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    if (count === 0) throw new NotFoundException(`Promo "${id}" not found`);
    return this.prisma.promoCode.findUnique({ where: { id } });
  }

  private assertDiscountValue(type: string, value: number) {
    if (type === 'PERCENT' && (value <= 0 || value > 100)) {
      throw new BadRequestException(
        'A PERCENT discountValue must be between 0 and 100.',
      );
    }
  }

  // ── Overview (ADMIN) ──

  async getOverview() {
    const [users, byStatus, revenue, openTickets, activeRecurring] =
      await this.prisma.$transaction([
        this.prisma.user.count(),
        this.prisma.delivery.groupBy({
          by: ['status'],
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: 'COMPLETED' },
        }),
        this.prisma.supportTicket.count({
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        }),
        this.prisma.recurringDelivery.count({ where: { active: true } }),
      ]);

    // Backfill every status to 0 so the dashboard shape is stable.
    const deliveriesByStatus: Record<string, number> = {};
    for (const s of Object.values(DeliveryStatus)) deliveriesByStatus[s] = 0;
    for (const row of byStatus as Array<{ status: string; _count: { _all: number } }>) {
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
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
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
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async setRole(actingAdminId: string, targetId: string, role: Role) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException(`User "${targetId}" not found`);

    // Don't strand the system with zero admins.
    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) {
        throw new ConflictException('Cannot demote the last remaining admin.');
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
