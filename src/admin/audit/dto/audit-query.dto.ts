import { AdminAuditAction, AdminAuditTargetType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * GET /admin/audit query. `from`/`to` are optional ISO date-times; when omitted the
 * service defaults to the last AUDIT_DEFAULT_WINDOW_DAYS days (see
 * admin-audit.constants.ts for why a partitioned table needs that default).
 */
export class AuditQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @IsOptional()
  @IsEnum(AdminAuditTargetType)
  targetType?: AdminAuditTargetType;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsEnum(AdminAuditAction)
  action?: AdminAuditAction;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
