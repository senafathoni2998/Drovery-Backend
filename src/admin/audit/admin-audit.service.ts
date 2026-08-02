import { Injectable } from '@nestjs/common';
import {
  AdminAuditAction,
  AdminAuditLog,
  AdminAuditTargetType,
  Prisma,
  Role,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_DEFAULT_WINDOW_DAYS } from './admin-audit.constants';
import { AuditQueryDto } from './dto/audit-query.dto';

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
 * The operator audit log's write AND read surface.
 *
 * It holds ONE PrismaService, and that client belongs to the READ side (`list`)
 * ALONE. The write side (`recordWithinTx`) must NEVER use `this.prisma` — it must
 * keep taking the CALLER's transaction client, so an audit row cannot commit
 * independently of the mutation it records. That is the whole guarantee. A write
 * that reached for `this.prisma` instead would still compile, and would still pass
 * a test that (like an unwary one might) passes the same object as both the
 * injected client and the transaction — only a test built to tell them apart
 * catches it. Getting this backwards silently reintroduces the best-effort trail
 * this service exists to replace.
 *
 * Failures propagate. An audit write that throws must roll the operator's action back:
 * a mutation that happened with no record of who did it is the exact state this exists
 * to make impossible.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Deliberately ignores `this.prisma` — see the class doc. Every write goes through
  // whatever transaction client the CALLER passes in.
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

  /**
   * The read surface. Defaults to the last AUDIT_DEFAULT_WINDOW_DAYS days when the
   * caller gives no `from`/`to` — `admin_audit_logs` is partitioned by `createdAt`,
   * and an unbounded `ORDER BY createdAt DESC LIMIT n` would touch every partition to
   * prove none has a newer row. The effective window is returned alongside the page
   * so a caller cannot mistake a windowed result for the whole history.
   *
   * Uses `findMany` + `count`, not `findUnique`: the table's primary key is the
   * composite `([id, createdAt])`, so there is no single-column unique `id` to
   * `findUnique` against.
   */
  async list(query: AuditQueryDto): Promise<{
    items: AdminAuditLog[];
    total: number;
    page: number;
    limit: number;
    from: Date;
    to: Date;
  }> {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(
          to.getTime() - AUDIT_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );

    const where: Prisma.AdminAuditLogWhereInput = {
      createdAt: { gte: from, lte: to },
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };

    // Operator reporting list — lag-tolerant → read replica (one consistent snapshot
    // via the reader's $transaction; falls back to primary).
    const [items, total] = await this.prisma.readWithFallback((c) =>
      c.$transaction([
        c.adminAuditLog.findMany({
          where,
          // `id` tiebreaker: `createdAt` alone is not unique, and paginating on a
          // non-unique sort key across partitions can repeat or skip rows between
          // pages (the delivery list backlog already records this exact defect).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: query.skip,
          take: query.limit,
        }),
        c.adminAuditLog.count({ where }),
      ]),
    );

    return {
      items,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      from,
      to,
    };
  }
}
