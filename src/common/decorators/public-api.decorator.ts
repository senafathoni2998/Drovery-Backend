import { applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

import { Public } from './public.decorator';

/**
 * Marks a route public for BOTH layers in lockstep (so they can't drift):
 *  - the global JwtAuthGuard skips it (via @Public), and
 *  - the OpenAPI spec clears the global Bearer requirement for this operation
 *    (`ApiSecurity({})` emits `security: [{}]` = "no auth"), so it shows no lock
 *    and doesn't falsely advertise a JWT (e.g. POST /auth/login can't require one).
 *
 * Use this instead of @Public() for user-facing public HTTP routes. The drone
 * ingest routes keep @Public() + @ApiSecurity('ingest-key') (key-authed, not open).
 */
export const PublicApi = () => applyDecorators(Public(), ApiSecurity({}));
