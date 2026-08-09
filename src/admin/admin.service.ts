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
import { isZoneInForce } from '../serviceability/airspace.constants';
import { AirspaceService } from '../serviceability/airspace.service';
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
import {
  CreateAirspaceZoneDto,
  UpdateAirspaceZoneDto,
} from './dto/airspace.dto';
import { AdminAuditService, AuditActor } from './audit/admin-audit.service';
import { diffAllowed, pickAllowed } from './audit/admin-audit.constants';

const USER_SELECT = { id: true, name: true, email: true } as const;

/**
 * The shape an airspace PATCH actually arrives in.
 *
 * `@IsOptional()` skips validation for `null` as well as `undefined`, so an explicit
 * `null` in the body reaches the service untouched and means "clear this bound" — a
 * distinction `UpdateAirspaceZoneDto` cannot express, since it types every field as
 * merely absent. Reading the patch through this type is what makes "unset the ceiling"
 * expressible without it being confused with "leave the ceiling alone".
 */
type AirspaceZonePatch = {
  [K in keyof UpdateAirspaceZoneDto]: UpdateAirspaceZoneDto[K] | null;
};

/**
 * The `airspace_zones` columns declared NOT NULL. `notes`, the altitude pair and the
 * window pair are all nullable, and an explicit `null` there legitimately clears them.
 *
 * These six need naming because nothing upstream rejects a `null` for them: see
 * `assertNoNullOnRequiredFields`.
 */
const REQUIRED_ZONE_FIELDS = [
  'name',
  'kind',
  'lat',
  'lng',
  'radiusKm',
  'active',
] as const;

const toDateOrNull = (value: string | null | undefined): Date | null =>
  value == null ? null : new Date(value);

/** Absent key → keep what is stored; present key (even as `null`) → take the patch. */
const mergeField = <T>(
  patched: T | null | undefined,
  current: T | null,
): T | null => (patched === undefined ? current : (patched ?? null));

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
    private readonly airspace: AirspaceService,
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
   * bump recency, auto-advance OPEN→IN_PROGRESS, fan out to the user live, and
   * record the audit row inside the SAME transaction as the two writes.
   *
   * `args` captures the message LENGTH, never its text — the content already
   * lives in `support_chat_messages` with its own `senderUserId`, and copying
   * customer prose into the audit row would widen what an audit read exposes
   * for no forensic gain. */
  async replyAsAgent(actor: AuditActor, ticketId: string, content: string) {
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

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportChatMessage.create({
        data: {
          ticketId,
          senderRole: 'AGENT',
          senderUserId: actor.userId, // attribution (audit); client renders by senderRole
          content,
        },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: new Date(),
          status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
        },
      });
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.SUPPORT_TICKET_REPLY,
        targetType: AdminAuditTargetType.SUPPORT_TICKET,
        targetId: ticketId,
        args: pickAllowed(AdminAuditAction.SUPPORT_TICKET_REPLY, {
          contentLength: content.length,
        }),
      });
      return created;
    });

    const payload = toSupportChatPayload(message);
    await this.chatPublisher.publishMessage(payload); // realtime to the user
    this.logger.log(`agent ${actor.userId} replied to ticket ${ticketId}`);
    return payload;
  }

  /** Set a ticket's status. Pre-reads the ticket so a missing one stays a clean
   *  404 and so the audit row has a `before` value; the `updateMany` count===0
   *  guard — a race where the ticket vanished between the read and the write —
   *  is checked BEFORE the audit call, inside the same transaction as the write.
   *  The row this returns is read back OUTSIDE that transaction: it needs no CAS
   *  guarantee of its own, and reading it inside would extend how long the
   *  `support_tickets` row lock is held for no benefit. */
  async setTicketStatus(
    actor: AuditActor,
    ticketId: string,
    status: SupportTicketStatus,
  ) {
    const before = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });
    if (!before)
      throw new AppNotFoundException('error.admin.ticket.not_found', {
        id: ticketId,
      });

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.supportTicket.updateMany({
        where: { id: ticketId },
        data: { status },
      });
      // BEFORE the audit call: an audit row for a status change that never
      // landed (the ticket vanished after the pre-read) invents an event.
      if (count === 0)
        throw new AppNotFoundException('error.admin.ticket.not_found', {
          id: ticketId,
        });
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.SUPPORT_TICKET_STATUS_SET,
        targetType: AdminAuditTargetType.SUPPORT_TICKET,
        targetId: ticketId,
        before: pickAllowed(AdminAuditAction.SUPPORT_TICKET_STATUS_SET, {
          status: before.status,
        }),
        after: pickAllowed(AdminAuditAction.SUPPORT_TICKET_STATUS_SET, {
          status,
        }),
      });
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
   * The delivery transitions only when the drone acks. 404/422/409 from the service.
   * The audit row co-commits with the command's creation — see
   * DroneCommandService.issue, which runs this callback inside that transaction and
   * hands back the row it just created (sourced from the CREATED row, not the dto,
   * for the same reason createDrone/createPromo do). */
  issueDroneCommand(
    actor: AuditActor,
    deliveryId: string,
    dto: IssueCommandDto,
  ) {
    return this.droneCommands.issue(
      actor.userId,
      deliveryId,
      dto,
      (tx, command) =>
        this.audit.recordWithinTx(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: AdminAuditAction.DRONE_COMMAND_ISSUE,
          targetType: AdminAuditTargetType.DELIVERY,
          targetId: deliveryId,
          args: pickAllowed(
            AdminAuditAction.DRONE_COMMAND_ISSUE,
            command as never,
          ),
        }),
    );
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

  // ── Airspace (ADMIN) ──
  //
  // Restricted airspace as DATA. A no-fly zone that needs a deploy to change is not
  // data, and these four routes are what make it so. They are also the first consumer
  // of the audit machinery outside the increment that built it.

  /**
   * The zone registry, INCLUDING deactivated zones.
   *
   * Deactivation is how a zone is "deleted" here, precisely so a zone that once
   * existed stays part of the record of why a past delivery was refused. Filtering the
   * inactive ones out of the operator's own list would put that record back out of
   * reach and defeat the reason the row is kept.
   *
   * UNPAGINATED, and read from the PRIMARY rather than through `readWithFallback`.
   * Both are deliberate and both are bets on this staying a small, hand-maintained
   * registry: an operator who has just added an emergency restriction and reloads the
   * list must see it, and replica lag would show them a registry without the zone they
   * just created. If TFRs ever accumulate to the point where this list is long, it
   * wants a page and a filter — the unpaginated read is the thing to revisit first.
   *
   * Each row carries a COMPUTED `inForce`. `active` is the operator's switch; `inForce`
   * is whether the zone is actually stopping anything right now. They come apart the
   * moment a time window is involved — a pre-staged TFR is `active: true, inForce: false`
   * and correctly so, and a zone whose window has closed is the same pair meaning the
   * opposite thing — and a console that shows only `active` reports protection that does
   * not exist. `active` alone was the whole of that display until now.
   *
   * Derived through `isZoneInForce`, the SAME predicate `AirspaceService` routes on, for
   * the obvious reason: a console that disagrees with the router is worse than one that
   * says less.
   */
  async listAirspaceZones(now: Date = new Date()) {
    const zones = await this.prisma.airspaceZone.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return zones.map((zone) => ({
      ...zone,
      inForce: isZoneInForce(zone, now),
    }));
  }

  /** Declare a new restricted zone. Live on the next quote this instance serves. */
  async createAirspaceZone(actor: AuditActor, dto: CreateAirspaceZoneDto) {
    const activeFrom = toDateOrNull(dto.activeFrom);
    const activeUntil = toDateOrNull(dto.activeUntil);
    // `true`: a create always writes the window, even when it writes it as null/null.
    this.assertZoneBounds(
      {
        activeFrom,
        activeUntil,
        floorM: dto.floorM ?? null,
        ceilingM: dto.ceilingM ?? null,
      },
      true,
    );

    const zone = await this.prisma.$transaction(async (tx) => {
      const created = await tx.airspaceZone.create({
        data: {
          name: dto.name,
          kind: dto.kind,
          lat: dto.lat,
          lng: dto.lng,
          radiusKm: dto.radiusKm,
          floorM: dto.floorM ?? null,
          ceilingM: dto.ceilingM ?? null,
          activeFrom,
          activeUntil,
          notes: dto.notes ?? null,
        },
      });
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.AIRSPACE_ZONE_CREATE,
        targetType: AdminAuditTargetType.AIRSPACE_ZONE,
        targetId: created.id,
        // From the CREATED ROW, not the DTO — same invariant as createDrone/createPromo.
        args: pickAllowed(
          AdminAuditAction.AIRSPACE_ZONE_CREATE,
          created as never,
        ),
      });
      return created;
    });

    this.dropZoneCacheAfterCommit();
    this.logger.log(
      `admin ${actor.userId} declared airspace zone ${zone.id} (${zone.kind}, ${zone.radiusKm} km)`,
    );
    return zone;
  }

  /** Edit a zone — including re-enabling one, via `active: true`. */
  async updateAirspaceZone(
    actor: AuditActor,
    id: string,
    dto: UpdateAirspaceZoneDto,
  ) {
    const before = await this.findZoneOr404(id); // 404; now also the audit's before
    const patch = dto as AirspaceZonePatch;
    this.assertNoNullOnRequiredFields(patch);

    // Validate the MERGED values, not the patch alone. `activeUntil` cannot be
    // inverted on its own, so a DTO-only check waves through a PATCH that closes the
    // window before the STORED activeFrom opens it — storing exactly the never-in-force
    // zone the 400 exists to reject. Same on the vertical axis.
    const activeFrom =
      patch.activeFrom !== undefined
        ? toDateOrNull(patch.activeFrom)
        : before.activeFrom;
    const activeUntil =
      patch.activeUntil !== undefined
        ? toDateOrNull(patch.activeUntil)
        : before.activeUntil;
    const floorM = mergeField(patch.floorM, before.floorM);
    const ceilingM = mergeField(patch.ceilingM, before.ceilingM);
    this.assertZoneBounds(
      { activeFrom, activeUntil, floorM, ceilingM },
      patch.activeFrom !== undefined || patch.activeUntil !== undefined,
    );

    // `!= null` on the six NOT NULL columns, `!== undefined` on the nullable ones. The
    // guard above already rejects a null here, so this is belt as well as braces — but
    // it is the line that decides whether a null REACHES Prisma, so it states the
    // nullability of each column rather than leaning on a check made 20 lines earlier.
    const data: Prisma.AirspaceZoneUpdateInput = {
      ...(dto.name != null ? { name: dto.name } : {}),
      ...(dto.kind != null ? { kind: dto.kind } : {}),
      ...(dto.lat != null ? { lat: dto.lat } : {}),
      ...(dto.lng != null ? { lng: dto.lng } : {}),
      ...(dto.radiusKm != null ? { radiusKm: dto.radiusKm } : {}),
      ...(dto.active != null ? { active: dto.active } : {}),
      ...(patch.floorM !== undefined ? { floorM } : {}),
      ...(patch.ceilingM !== undefined ? { ceilingM } : {}),
      ...(patch.activeFrom !== undefined ? { activeFrom } : {}),
      ...(patch.activeUntil !== undefined ? { activeUntil } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };

    const zone = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.airspaceZone.update({ where: { id }, data });
      const diff = diffAllowed(
        AdminAuditAction.AIRSPACE_ZONE_UPDATE,
        before as never,
        updated as never,
      );
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.AIRSPACE_ZONE_UPDATE,
        targetType: AdminAuditTargetType.AIRSPACE_ZONE,
        targetId: id,
        before: diff.before,
        after: diff.after,
      });
      return updated;
    });

    this.dropZoneCacheAfterCommit();
    this.logger.log(`admin ${actor.userId} edited airspace zone ${id}`);
    return zone;
  }

  /**
   * "Delete" a zone. It is a DEACTIVATION and never a row delete: a zone that once
   * existed is part of the record of why a past delivery was refused, and hard-deleting
   * it makes that refusal unexplainable afterwards.
   *
   * Records with `pickAllowed` PAIRS rather than `diffAllowed`, matching setRole and
   * setTicketStatus as the other single-field setters. `diffAllowed` on an
   * already-inactive zone emits `before: null, after: null` — a row asserting an
   * operator touched the zone and changed nothing, which the batteryPercent allowlist
   * entry documents as worse than no row at all. The operator DID act; the row says
   * what state the zone was already in.
   */
  async deactivateAirspaceZone(actor: AuditActor, id: string) {
    const before = await this.findZoneOr404(id); // 404 BEFORE anything is recorded

    const zone = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.airspaceZone.update({
        where: { id },
        data: { active: false },
      });
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.AIRSPACE_ZONE_DEACTIVATE,
        targetType: AdminAuditTargetType.AIRSPACE_ZONE,
        targetId: id,
        before: pickAllowed(AdminAuditAction.AIRSPACE_ZONE_DEACTIVATE, {
          active: before.active,
        }),
        // From the UPDATED ROW, not the literal `false` written above.
        after: pickAllowed(AdminAuditAction.AIRSPACE_ZONE_DEACTIVATE, {
          active: updated.active,
        }),
      });
      return updated;
    });

    this.dropZoneCacheAfterCommit();
    this.logger.log(`admin ${actor.userId} deactivated airspace zone ${id}`);
    return zone;
  }

  /**
   * Reject an explicit `null` on a column that cannot hold one.
   *
   * `@IsOptional()` skips validation when the value is `null` as well as when it is
   * `undefined`, and `whitelist: true` KEEPS a decorated property whose validators were
   * skipped. So `{"active": null}` arrives here having been checked by nothing at all.
   * Six of these columns are NOT NULL, and handing Prisma a null for one raises a
   * `PrismaClientValidationError` that no filter maps — a 500 for what is a malformed
   * request. `createAirspaceZone` is unaffected: its five required fields carry no
   * `@IsOptional()`, so class-validator rejects a null there itself.
   *
   * Rejected, not dropped. Dropping the key would turn the operator's edit into a
   * silent no-op — they asked for something, got a 200, and nothing changed.
   */
  private assertNoNullOnRequiredFields(patch: AirspaceZonePatch) {
    const nulled = REQUIRED_ZONE_FIELDS.filter((f) => patch[f] === null);
    if (nulled.length) {
      throw new AppBadRequestException(
        'error.admin.airspace.null_not_allowed',
        { fields: nulled.join(', ') },
      );
    }
  }

  private async findZoneOr404(id: string) {
    const zone = await this.prisma.airspaceZone.findUnique({ where: { id } });
    if (!zone) {
      throw new AppNotFoundException('error.admin.airspace.not_found', { id });
    }
    return zone;
  }

  /**
   * Both bounds rejected LOUDLY, as a 400 — deliberately unlike the audit-log query's
   * inverted `from`/`to` range, which returns an empty 200. A zone that is never in
   * force reads to an operator as protection that exists, and the whole surface is
   * about protection existing.
   *
   * `>=` on both, not `>`: a window whose ends coincide is in force for a single
   * instant, and a floor level with its ceiling is a zone of zero height. Neither is
   * a restriction; both are almost certainly a typo.
   *
   * THREE checks, not two. The inverted-window check only fires when BOTH bounds are
   * present, and the seeded airports store `activeFrom: null` — so
   * `PATCH {"activeUntil": "2020-01-01"}` on Soekarno-Hatta was a 200 that took a
   * protected airport out of force on the next cache refresh, while the console kept
   * showing `active: true`. Half the stated scope of a guard whose whole reason for
   * existing is that "never in force" must not be reachable by accident.
   *
   * The rule, stated plainly: to take a zone out of force NOW you deactivate it — that
   * is what `DELETE` is for, and it keeps the row as the record of why a past delivery
   * was refused. A write that lands a zone in an already-expired state is therefore a
   * mistake every time; there is no legitimate request it turns away.
   *
   * `windowWritten` scopes it to writes that actually SET a bound. Merging alone is not
   * enough here, and this is the one place it differs from the two checks above: an
   * inverted window can never be a zone's stored state (this guard prevents it), but an
   * EXPIRED window is the normal resting state of every TFR that has run its course.
   * Gating on the merged values unconditionally would 400 an operator fixing a typo in
   * the `notes` of a zone that closed last week — bricking the historical record this
   * surface deliberately keeps. Touch the window and it must not land in the past; leave
   * the window alone and the past is just history.
   */
  private assertZoneBounds(
    zone: {
      activeFrom: Date | null;
      activeUntil: Date | null;
      floorM: number | null;
      ceilingM: number | null;
    },
    windowWritten: boolean,
    now: Date = new Date(),
  ) {
    if (
      zone.activeFrom &&
      zone.activeUntil &&
      zone.activeFrom.getTime() >= zone.activeUntil.getTime()
    ) {
      throw new AppBadRequestException('error.admin.airspace.inverted_window');
    }
    // `<`, not `<=`: the window closes INCLUSIVELY (`isZoneInForce` uses `>=`), so a
    // zone expiring at exactly this instant is in force, for an instant. Matching the
    // reader's boundary matters more than the instant does.
    if (
      windowWritten &&
      zone.activeUntil &&
      zone.activeUntil.getTime() < now.getTime()
    ) {
      throw new AppBadRequestException('error.admin.airspace.past_window');
    }
    if (
      zone.floorM !== null &&
      zone.ceilingM !== null &&
      zone.floorM >= zone.ceilingM
    ) {
      throw new AppBadRequestException(
        'error.admin.airspace.inverted_altitude',
      );
    }
  }

  /**
   * Drop the cached zone list. Call this AFTER the transaction has committed.
   *
   * Inside the transaction it would drop the cache for a write that may still roll
   * back, which is merely wasteful. Immediately BEFORE the commit is the real hazard:
   * a reader racing in that gap refills the cache from a snapshot that predates the
   * new zone, and then serves that stale list for a full TTL. A new restriction that
   * is not live until a TTL expires is a restriction that is not enforced.
   *
   * SCOPE, and it is narrow: this clears only THIS process's cache. Every other
   * instance keeps serving its own rows until `AIRSPACE_CACHE_TTL_MS` elapses. That bound
   * is stated on the constant itself (`serviceability/airspace.constants.ts`), and it
   * covers WRITES only — which is all this helper is about. A zone coming into force by
   * the clock needs no invalidation at all: `AirspaceService` evaluates the window per
   * call, after the cache.
   */
  private dropZoneCacheAfterCommit() {
    this.airspace.invalidate();
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

  /** Change a user's role. The target read and the last-admin guard stay OUTSIDE
   *  any transaction — they only ever 404/409, never mutate — and only `user.update`
   *  plus the audit write are wrapped, so the two co-commit. */
  async setRole(actor: AuditActor, targetId: string, role: Role) {
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetId },
        data: { role },
        select: { id: true, email: true, role: true },
      });
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.USER_ROLE_SET,
        targetType: AdminAuditTargetType.USER,
        targetId,
        before: pickAllowed(AdminAuditAction.USER_ROLE_SET, {
          role: target.role,
        }),
        after: pickAllowed(AdminAuditAction.USER_ROLE_SET, {
          role: user.role,
        }),
      });
      return user;
    });
    this.logger.log(`admin ${actor.userId} set user ${targetId} role=${role}`);
    return updated;
  }
}
