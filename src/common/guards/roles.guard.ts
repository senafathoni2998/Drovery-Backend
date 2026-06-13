import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Authorizes role-gated routes. Registered globally AFTER JwtAuthGuard, but
 * INERT on any route without @Roles (returns true with no DB read) — so consumer
 * routes are untouched. On a @Roles route it resolves the user's role FRESH from
 * the DB (the JWT carries no role, so a demote takes effect immediately) and
 * denies by default.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // not a role-gated route

    const req = context.switchToHttp().getRequest();
    const userId = req.user?.sub as string | undefined;
    if (!userId) throw new ForbiddenException('Insufficient permissions');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    req.user.role = user.role; // available downstream / for logging
    return true;
  }
}
