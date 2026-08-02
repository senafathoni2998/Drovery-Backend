import { ApiProperty } from '@nestjs/swagger';
import { AdminAuditAction, AdminAuditTargetType, Role } from '@prisma/client';

/**
 * Operator audit log row. `before` / `after` / `args` are the allowlisted JSON blobs
 * admin-audit.constants.ts produced at write time (see AUDIT_FIELD_ALLOWLIST) — their
 * shape varies by `action`, and a captured field can legitimately be `null` (e.g. a
 * delivery-status transition's `before.status` when the prior status read came back
 * empty). Kept loosely typed rather than a per-action union for that reason.
 */
export class AdminAuditLogResponseDto {
  id: string;
  createdAt: Date;
  actorUserId: string;
  @ApiProperty({ enum: Role })
  actorRole: Role;
  @ApiProperty({ enum: AdminAuditAction })
  action: AdminAuditAction;
  @ApiProperty({ enum: AdminAuditTargetType })
  targetType: AdminAuditTargetType;
  targetId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  args?: Record<string, unknown> | null;
}

export class AdminPaginatedAuditDto {
  @ApiProperty({ type: [AdminAuditLogResponseDto] })
  items: AdminAuditLogResponseDto[];
  total: number;
  page: number;
  limit: number;
  /** Effective window applied after defaulting, so a windowed page is never mistaken
   *  for the whole history. */
  from: Date;
  to: Date;
}
