import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AppForbiddenException } from '../../common/exceptions/app-exception';
import { AuditActor as Actor } from './admin-audit.service';

/** The decorator and the shape it produces under one name, so a controller writes
 *  `@AuditActor() actor: AuditActor` off a single import. Value and type live in
 *  separate declaration spaces; the shape itself is still defined next to the service
 *  that consumes it. */
export type AuditActor = Actor;

/**
 * The operator behind an audited mutation, assembled in ONE place.
 *
 * Eleven routes need `{ userId, role }`. Building it inline from a
 * `@CurrentUser('sub')` + `@CurrentUser('role')` pair makes eleven copies of a mistake
 * that nothing can catch: `createParamDecorator` returns an untyped
 * `ParameterDecorator`, so the declared parameter types constrain nothing and
 * `@CurrentUser('role') actorId: string` compiles. The swap surfaces only in
 * production, as a UUID written into a non-null Role enum column — and since the audit
 * row co-commits with the CAS, the rejected insert rolls the whole mutation back.
 *
 * One decorator, one test, eleven call sites that cannot get it wrong.
 *
 * Both halves come off the request with no extra read: `sub` is the JWT subject, and
 * `role` is the DB-fresh one RolesGuard resolved and wrote onto `req.user` — the token
 * deliberately carries no role, so a demote takes effect on the next request.
 */
export const AuditActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => {
    const user = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    // Fail closed. Reaching here without a role means the route is missing @Roles,
    // and an audit row naming `undefined` as the actor is worse than a refused
    // request — it is a record that looks like evidence and is not.
    if (!user?.sub || !user.role) {
      throw new AppForbiddenException('error.authz.forbidden');
    }
    return { userId: user.sub, role: user.role };
  },
);
