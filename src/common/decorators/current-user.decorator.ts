import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * NOT from the token — the JWT deliberately carries no role, so a demote takes
   * effect on the next request rather than the next login. RolesGuard resolves it
   * fresh from the DB and writes it here, so it is present on @Roles routes and
   * absent everywhere else. Hence optional.
   */
  role?: Role;
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayload;
    return data ? user?.[data] : user;
  },
);
