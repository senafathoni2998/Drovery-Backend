import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DroneCommand,
  DroneCommandStatus,
  DroneCommandType,
  Prisma,
  TrackingSource,
} from '@prisma/client';

import { MetricsService } from '../../metrics/metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveriesService } from '../deliveries.service';
import { IssueCommandDto } from '../../admin/dto/admin.dto';
import {
  COMMAND_TTL_MS,
  COMMAND_TYPE_DEFAULT_REASON,
  COMMAND_TYPE_TO_LEGAL_STATUSES,
  MAX_COMMANDS_PER_DELIVERY,
} from './command.constants';

/** What the (mock) drone sees on a poll — the operator-audit fields are omitted. */
export interface DroneCommandView {
  id: string;
  deliveryId: string;
  droneId: string;
  type: DroneCommandType;
  reason: DroneCommand['reason'];
  status: DroneCommandStatus;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * The backend -> drone command outbox (P3 follow-on). An ADMIN issues a command;
 * the (mock) drone polls + acks it over the existing /ingest transport; the ack is
 * the SOLE trigger that drives the delivery, via the existing single-winner CAS
 * transitions (beginReturnToBase / failExceptional). The command row is a durable
 * audit/outbox, NOT a second source of truth — the Delivery row stays authoritative.
 */
@Injectable()
export class DroneCommandService {
  private readonly logger = new Logger(DroneCommandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
    private readonly metrics: MetricsService,
  ) {}

  // ── Operator side (ADMIN) ─────────────────────────────────────────────────

  /** Issue a PENDING command. Does NOT touch the delivery — the ack does. */
  async issue(
    adminId: string,
    deliveryId: string,
    dto: IssueCommandDto,
  ): Promise<DroneCommand> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: {
        id: true,
        createdAt: true,
        status: true,
        trackingSource: true,
        assignedDroneId: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.trackingSource !== TrackingSource.LIVE) {
      // No real drone drives a SIMULATED delivery — there is nothing to command.
      throw new UnprocessableEntityException(
        'Only LIVE deliveries can be commanded',
      );
    }
    if (!delivery.assignedDroneId) {
      throw new ConflictException('Delivery has no assigned drone');
    }
    const legal = COMMAND_TYPE_TO_LEGAL_STATUSES[dto.type];
    if (!legal.includes(delivery.status)) {
      // Fail fast; the ack-time CAS is still the authoritative guard.
      throw new ConflictException(
        `Cannot ${dto.type} a delivery in status ${delivery.status}`,
      );
    }
    const reason = dto.reason ?? COMMAND_TYPE_DEFAULT_REASON[dto.type];

    // The partial-unique index only bounds OPEN commands; cap total rows per
    // delivery so repeated issue→expire/reject cycles can't grow the table without
    // bound (the open-slot 409 below still guards the common case).
    const total = await this.prisma.droneCommand.count({
      where: { deliveryId },
    });
    if (total >= MAX_COMMANDS_PER_DELIVERY) {
      throw new ConflictException('Command limit reached for this delivery');
    }

    try {
      const command = await this.prisma.droneCommand.create({
        data: {
          deliveryId,
          deliveryCreatedAt: delivery.createdAt,
          droneId: delivery.assignedDroneId,
          type: dto.type,
          reason,
          issuedByUserId: adminId,
          expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
        },
      });
      this.metrics.droneCommandsTotal.inc({ type: dto.type, result: 'issued' });
      this.logger.log(
        `command ${command.id} ${dto.type} issued by admin ${adminId} for delivery ${deliveryId} (reason ${reason})`,
      );
      return command;
    } catch (e) {
      // The partial-unique index (one open command per delivery) → P2002 → 409.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A command is already pending for this delivery',
        );
      }
      throw e;
    }
  }

  /** Admin audit history for a delivery (newest first). */
  async listForDelivery(deliveryId: string): Promise<DroneCommand[]> {
    const exists = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Delivery not found');
    return this.prisma.droneCommand.findMany({
      where: { deliveryId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Drone side (DroneAuthGuard) ───────────────────────────────────────────

  /**
   * The drone polls its queue. Returns the OLDEST open (PENDING|FETCHED) command
   * for this drone, transitioning a PENDING one to FETCHED. Re-polling before ack
   * returns the SAME FETCHED row (at-least-once redelivery). Expired commands are
   * never handed out.
   */
  async fetchPending(
    droneId: string,
  ): Promise<{ command: DroneCommandView | null }> {
    const now = new Date();
    const command = await this.prisma.droneCommand.findFirst({
      where: {
        droneId,
        status: {
          in: [DroneCommandStatus.PENDING, DroneCommandStatus.FETCHED],
        },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        delivery: { select: { trackingSource: true, assignedDroneId: true } },
      },
    });
    if (!command) return { command: null };

    // Ownership (defense-in-depth; mirrors telemetry): the delivery must still be
    // LIVE and bound to THIS drone. A stranger key with a wrong droneId never
    // matches the filter above and lands here as an empty queue.
    if (
      command.delivery.trackingSource !== TrackingSource.LIVE ||
      command.delivery.assignedDroneId !== droneId
    ) {
      return { command: null };
    }

    if (command.status === DroneCommandStatus.PENDING) {
      const { count } = await this.prisma.droneCommand.updateMany({
        where: { id: command.id, status: DroneCommandStatus.PENDING },
        data: { status: DroneCommandStatus.FETCHED, fetchedAt: now },
      });
      if (count > 0) {
        this.metrics.droneCommandsTotal.inc({
          type: command.type,
          result: 'fetched',
        });
      } else {
        // Lost the PENDING→FETCHED CAS to a sibling poll OR a concurrent watchdog
        // expiry sweep. Re-read the truth rather than reporting an assumed FETCHED:
        // if it's no longer FETCHED (e.g. EXPIRED), hand the drone nothing.
        const fresh = await this.prisma.droneCommand.findFirst({
          where: { id: command.id },
          select: { status: true },
        });
        if (fresh?.status !== DroneCommandStatus.FETCHED)
          return { command: null };
      }
    }

    return { command: this.toView(command) };
  }

  /**
   * The drone acknowledges a command. accepted=true (default) drives the delivery
   * via the mapped existing transition; accepted=false records a refusal. The claim
   * CAS (FETCHED → terminal) is the single-winner gate, so a duplicate/replayed ack
   * 409s and never re-fires the transition.
   */
  async ack(
    commandId: string,
    droneId: string,
    accepted: boolean,
    note?: string,
  ): Promise<{
    id: string;
    status: DroneCommandStatus;
    appliedTransition: boolean;
  }> {
    // `drone_commands` is partitioned (composite PK), and `commandId` is a raw URL param
    // with no deliveryCreatedAt in scope → findFirst (the uuid id matches at most one row).
    // The full row it returns carries deliveryCreatedAt for the composite-key updates below.
    const command = await this.prisma.droneCommand.findFirst({
      where: { id: commandId },
      include: {
        delivery: { select: { trackingSource: true, assignedDroneId: true } },
      },
    });
    if (!command) throw new NotFoundException('Command not found');

    if (
      command.droneId !== droneId ||
      command.delivery.trackingSource !== TrackingSource.LIVE ||
      command.delivery.assignedDroneId !== droneId
    ) {
      throw new ForbiddenException('Drone is not assigned to this delivery');
    }

    // An expired-but-still-FETCHED command must never execute late.
    if (command.expiresAt.getTime() <= Date.now()) {
      const { count } = await this.prisma.droneCommand.updateMany({
        where: {
          id: commandId,
          status: {
            in: [DroneCommandStatus.PENDING, DroneCommandStatus.FETCHED],
          },
        },
        data: { status: DroneCommandStatus.EXPIRED },
      });
      // Count this lazy expiry under the real type (the watchdog sweep counts the
      // never-polled-again ones); gated so a concurrent sweep/ack can't double-count.
      if (count > 0) {
        this.metrics.droneCommandsTotal.inc({
          type: command.type,
          result: 'expired',
        });
      }
      throw new ConflictException('Command has expired');
    }

    const accept = accepted !== false; // default true
    const claimStatus = accept
      ? DroneCommandStatus.ACKED
      : DroneCommandStatus.REJECTED;

    // Single-winner claim: only the first ack moves FETCHED → terminal.
    const { count } = await this.prisma.droneCommand.updateMany({
      where: { id: commandId, status: DroneCommandStatus.FETCHED },
      data: {
        status: claimStatus,
        ackedAt: new Date(),
        resultNote: note ?? null,
      },
    });
    if (count === 0) {
      throw new ConflictException('Command is not awaiting acknowledgement');
    }

    let appliedTransition = false;
    let finalStatus: DroneCommandStatus = claimStatus;

    if (accept) {
      // Drive the delivery via the EXISTING transition (idempotent CAS). It no-ops
      // (returns false) if telemetry/watchdog already moved the row — then this
      // command becomes a REJECTED no-op rather than a misleading ACKED.
      appliedTransition =
        command.type === DroneCommandType.RETURN_TO_BASE
          ? await this.deliveries.beginReturnToBase(
              command.deliveryId,
              command.reason,
            )
          : await this.deliveries.failExceptional(
              command.deliveryId,
              command.reason,
            );

      if (appliedTransition) {
        await this.prisma.droneCommand.update({
          where: {
            id_deliveryCreatedAt: {
              id: commandId,
              deliveryCreatedAt: command.deliveryCreatedAt,
            },
          },
          data: { appliedTransition: true },
        });
      } else {
        finalStatus = DroneCommandStatus.REJECTED;
        await this.prisma.droneCommand.update({
          where: {
            id_deliveryCreatedAt: {
              id: commandId,
              deliveryCreatedAt: command.deliveryCreatedAt,
            },
          },
          data: {
            status: DroneCommandStatus.REJECTED,
            resultNote: note ?? 'delivery no longer in a commandable state',
          },
        });
      }
    }

    // Distinguish a genuine drone REFUSAL (accepted=false) from an accepted ack
    // whose transition no-op'd because the delivery already moved (superseded) —
    // collapsing them would blind an operator to actual fleet refusals.
    const result = !accept
      ? 'rejected'
      : appliedTransition
        ? 'acked'
        : 'superseded';
    this.metrics.droneCommandsTotal.inc({ type: command.type, result });
    this.metrics.droneCommandTimeToAck.observe(
      { type: command.type, result },
      (Date.now() - command.createdAt.getTime()) / 1000,
    );
    this.logger.log(
      `command ${commandId} ${command.type} acked accepted=${accept} appliedTransition=${appliedTransition} for delivery ${command.deliveryId}`,
    );

    return { id: commandId, status: finalStatus, appliedTransition };
  }

  private toView(command: DroneCommand): DroneCommandView {
    return {
      id: command.id,
      deliveryId: command.deliveryId,
      droneId: command.droneId,
      type: command.type,
      reason: command.reason,
      status:
        command.status === DroneCommandStatus.PENDING
          ? DroneCommandStatus.FETCHED // reflect the transition we just made
          : command.status,
      expiresAt: command.expiresAt,
      createdAt: command.createdAt,
    };
  }
}
