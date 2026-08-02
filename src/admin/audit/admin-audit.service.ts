import { Injectable } from '@nestjs/common';
import {
  AdminAuditAction,
  AdminAuditTargetType,
  Prisma,
  Role,
} from '@prisma/client';

/** Who is acting. Assembled at the controller boundary, where RolesGuard has already
 *  written the DB-fresh role onto the request. */
export interface AuditActor {
  userId: string;
  role: Role;
}

export interface AuditEntry {
  actorUserId: string;
  actorRole: Role;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

/**
 * The operator audit log's write side.
 *
 * It holds NO PrismaService. Every method takes the caller's transaction client, so an
 * audit row cannot commit independently of the mutation it records — which is the whole
 * guarantee. A service with its own client would compile, pass tests, and silently
 * reintroduce the best-effort trail this replaces.
 *
 * Failures propagate. An audit write that throws must roll the operator's action back:
 * a mutation that happened with no record of who did it is the exact state this exists
 * to make impossible.
 */
@Injectable()
export class AdminAuditService {
  async recordWithinTx(
    tx: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before as Prisma.InputJsonValue | undefined,
        after: entry.after as Prisma.InputJsonValue | undefined,
        args: entry.args as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
