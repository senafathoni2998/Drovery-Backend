import { Injectable, Logger } from '@nestjs/common';
import {
  AdminAuditAction,
  AdminAuditTargetType,
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
  AdminDroneQueryDto,
  CreateDroneDto,
  UpdateDroneDto,
  AdminTicketQueryDto,
  AdminUserQueryDto,
  CreatePromoDto,
  IssueCommandDto,
  UpdatePromoDto,
} from './dto/admin.dto';
import { AdminAuditService, AuditActor } from './audit/admin-audit.service';
import { diffAllowed, pickAllowed } from './audit/admin-audit.constants';

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
    private readonly audit: AdminAuditService,
  ) {}

  // ── Support inbox (AGENT + ADMIN) ──

  async listTickets(query: AdminTicketQueryDto) {
    const q = query.q?.trim();
    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      // Search what an agent actually has in front of them: the opening message,
      // or the customer's name/email from the caller on the phone.
      ...(q
        ? {
            OR: [
              { message: { contains: q, mode: 'insensitive' as const } },
              {
                user: { email: { contains: q, mode: 'insensitive' as const } },
              },
              { user: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
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
    const q = query.q?.trim();
    const where: Prisma.DeliveryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      // trackingId first — it is the thing a customer reads out over the phone.
      ...(q
        ? {
            OR: [
              { trackingId: { contains: q, mode: 'insensitive' as const } },
              { fromAddress: { contains: q, mode: 'insensitive' as const } },
              { toAddress: { contains: q, mode: 'insensitive' as const } },
              { receiver: { contains: q, mode: 'insensitive' as const } },
              {
                user: { email: { contains: q, mode: 'insensitive' as const } },
              },
            ],
          }
        : {}),
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

  /** Force-cancel a stuck delivery in any non-terminal state. The audit row co-commits
   * with the CAS that performs it — the delivery service owns that transaction and runs
   * this callback inside it, handing back the status the cancel actually fired from.
   *
   * Every captured payload here goes through `pickAllowed`, even where the literal is
   * already exactly the allowlisted field. It is the difference between the allowlist
   * being the one chokepoint every writer passes through and it being a rule some
   * writers happen to satisfy — and the next writer copies whichever it finds. */
  forceCancel(actor: AuditActor, deliveryId: string) {
    return this.deliveries.adminForceCancel(deliveryId, (tx, firedFrom) =>
      this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.DELIVERY_FORCE_CANCEL,
        targetType: AdminAuditTargetType.DELIVERY,
        targetId: deliveryId,
        before: pickAllowed(AdminAuditAction.DELIVERY_FORCE_CANCEL, {
          status: firedFrom,
        }),
      }),
    );
  }

  /** Fail an in-flight delivery as a first-class exception (default ADMIN_ABORT,
   * a drone-fault reason → refunds the customer). 404/409 like force-cancel. */
  fail(actor: AuditActor, deliveryId: string, reason?: DeliveryFailureReason) {
    // Record the RESOLVED reason, not the caller's: the row has to say what was
    // written to the delivery, and `undefined` says nothing about who chose the default.
    const resolved = reason ?? DeliveryFailureReason.ADMIN_ABORT;
    return this.deliveries.adminFail(deliveryId, resolved, (tx, firedFrom) =>
      this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.DELIVERY_FAIL,
        targetType: AdminAuditTargetType.DELIVERY,
        targetId: deliveryId,
        before: pickAllowed(AdminAuditAction.DELIVERY_FAIL, {
          status: firedFrom,
        }),
        args: pickAllowed(AdminAuditAction.DELIVERY_FAIL, { reason: resolved }),
      }),
    );
  }

  /**
   * Goodwill refund as a wallet credit (Stripe has no refund integration). Idempotent
   * via the `admin-refund:<id>` key; marks the Payment REFUNDED for bookkeeping.
   *
   * KNOWN LIMITATION — PARTIAL REFUNDS CONSUME THE WHOLE BUDGET.
   * The at-most-once gate below is a boolean on Payment.status, so refunding less
   * than the full amount still flips the row to REFUNDED. The remainder can then
   * never be refunded through this endpoint, and the automatic drone-fault refund
   * (WalletService.refundChargeToWallet, keyed `exception-refund:<id>`) is dead for
   * that delivery too. The admin console does expose a partial-amount field, so this
   * is reachable.
   *
   * It is deliberately NOT fixed here. Doing it properly needs a cumulative refunded
   * amount — either a column on Payment or a sum over the WalletTransaction ledger —
   * AND a per-refund idempotency key instead of the per-delivery one, which is a
   * money-safety change that wants a real payments integration to test against.
   * Tracked as Phase 10 (`AUDIT-PLAN.md`), which rewrites this path anyway.
   *
   * What it is NOT: a double-refund. The CAS still guarantees at most one credit per
   * delivery across both channels. The failure mode is under-refunding, not over-. */
  async refund(actor: AuditActor, deliveryId: string, amount?: number) {
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
        // AFTER the gate and the credit, inside the same transaction: a refund that
        // lost the gate above never reaches here, and an audit row for a refund that
        // did not happen invents an event.
        await this.audit.recordWithinTx(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: AdminAuditAction.DELIVERY_REFUND,
          targetType: AdminAuditTargetType.DELIVERY,
          targetId: deliveryId,
          args: pickAllowed(AdminAuditAction.DELIVERY_REFUND, {
            amount: refundAmount,
          }),
        });
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

  // ── Fleet ──

  /**
   * The fleet registry. Until this existed there was no way to create a Drone at all,
   * which — once assignedDroneId became a foreign key — meant a LIVE delivery could
   * not be created by anyone. SIMULATED (the default) was unaffected.
   */
  async listDrones(query: AdminDroneQueryDto) {
    const q = query.q?.trim();
    const where: Prisma.DroneWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { serial: { contains: q, mode: 'insensitive' as const } },
              { model: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.readWithFallback((c) =>
      c.$transaction([
        c.drone.findMany({
          where,
          orderBy: [{ status: 'asc' }, { serial: 'asc' }],
          skip: query.skip,
          take: query.limit,
        }),
        c.drone.count({ where }),
      ]),
    );
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getDrone(id: string) {
    const drone = await this.prisma.drone.findUnique({ where: { id } });
    if (!drone) {
      throw new AppNotFoundException('error.admin.drone.not_found', { id });
    }
    return drone;
  }

  /** Register an aircraft. `serial` is the physical marking and must be unique. The
   *  P2002 translation stays OUTSIDE the transaction: a duplicate serial must still
   *  surface as the domain conflict, and rolling the transaction back on that error
   *  means no audit row is ever written for a registration that never happened. */
  async createDrone(actor: AuditActor, dto: CreateDroneDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const drone = await tx.drone.create({ data: { ...dto } });
        await this.audit.recordWithinTx(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: AdminAuditAction.DRONE_CREATE,
          targetType: AdminAuditTargetType.DRONE,
          targetId: drone.id,
          // Sourced from the CREATED ROW, not the DTO — see createPromo below, which
          // must do this because `code` is normalized on write. Doing the same here
          // even though today's allowed fields pass through unchanged means Task 6
          // and any later create route copy the invariant that survives a create
          // gaining its own normalization, not the one that happens to work today.
          args: pickAllowed(AdminAuditAction.DRONE_CREATE, drone as never),
        });
        return drone;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppConflictException('error.admin.drone.serial_exists', {
          serial: dto.serial,
        });
      }
      throw e;
    }
  }

  /**
   * Update an aircraft — including grounding it.
   *
   * Grounding does NOT recall a drone that is already flying: `airworthy` and
   * `status` are dispatch preconditions, so clearing them stops the NEXT claim. A
   * drone in the air is recalled with a RETURN_TO_BASE command, which is a different
   * operation with different safety semantics.
   */
  async updateDrone(actor: AuditActor, id: string, dto: UpdateDroneDto) {
    const before = await this.getDrone(id); // 404 if missing; now also the audit's before
    const drone = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.drone.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.maintenanceDueAt
            ? { maintenanceDueAt: new Date(dto.maintenanceDueAt) }
            : {}),
        },
      });
      const diff = diffAllowed(
        AdminAuditAction.DRONE_UPDATE,
        before as never,
        updated as never,
      );
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.DRONE_UPDATE,
        targetType: AdminAuditTargetType.DRONE,
        targetId: id,
        before: diff.before,
        after: diff.after,
      });
      return updated;
    });
    this.logger.log(
      `drone ${drone.serial} updated by ${actor.userId} (status=${drone.status} airworthy=${drone.airworthy})`,
    );
    return drone;
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

  async createPromo(actor: AuditActor, dto: CreatePromoDto) {
    this.assertDiscountValue(dto.discountType, dto.discountValue);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const promo = await tx.promoCode.create({
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
        await this.audit.recordWithinTx(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: AdminAuditAction.PROMO_CREATE,
          targetType: AdminAuditTargetType.PROMO,
          targetId: promo.id,
          args: pickAllowed(AdminAuditAction.PROMO_CREATE, promo as never),
        });
        return promo;
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

  async updatePromo(actor: AuditActor, id: string, dto: UpdatePromoDto) {
    const before = await this.getPromo(id); // 404 if missing; now also the audit's before
    // Update can change discountValue but NOT discountType — so validate the new value
    // against the EXISTING type (createPromo enforces this; update must too, or a PERCENT
    // promo could be PATCHed to >100%).
    if (dto.discountValue !== undefined) {
      this.assertDiscountValue(before.discountType, dto.discountValue);
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.promoCode.updateMany({
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
      // BEFORE the audit call: an audit row for an update that matched nothing
      // invents an event.
      if (count === 0)
        throw new AppNotFoundException('error.admin.promo.not_found', { id });
      // Re-read INSIDE the transaction so the `after` diff sees the committed values,
      // not a stale pre-update snapshot.
      const after = await tx.promoCode.findUnique({ where: { id } });
      const diff = diffAllowed(
        AdminAuditAction.PROMO_UPDATE,
        before as never,
        after as never,
      );
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.PROMO_UPDATE,
        targetType: AdminAuditTargetType.PROMO,
        targetId: id,
        before: diff.before,
        after: diff.after,
      });
      return after;
    });
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
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { name: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
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
