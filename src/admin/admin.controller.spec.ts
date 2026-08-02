import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { DeliveryFailureReason, Role } from '@prisma/client';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditActor } from './audit/audit-actor.decorator';

/**
 * Pull the REAL factory out of a param decorator's route-args metadata.
 *
 * Every controller spec in this repo calls the handler directly with plain arguments,
 * which bypasses the param decorators entirely — so the assembly of `{ userId, role }`
 * out of the request is invisible to all of them. And no type can stand in for the
 * coverage: `createParamDecorator` returns an untyped `ParameterDecorator`, so
 * `@CurrentUser('role') actorId: string` type-checks happily while writing a role into
 * the id. Running the factory is the only thing that can see it.
 */
function factoryOf(decorator: () => ParameterDecorator) {
  class Probe {
    handler(@decorator() actor: unknown) {
      return actor;
    }
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  return (
    Object.values(meta)[0] as { factory: (d: unknown, c: unknown) => unknown }
  ).factory;
}

describe('AdminController', () => {
  let controller: AdminController;
  let admin: { forceCancel: jest.Mock; fail: jest.Mock; refund: jest.Mock };

  const ACTOR = { userId: 'u-1', role: Role.ADMIN };

  beforeEach(async () => {
    admin = {
      forceCancel: jest.fn().mockResolvedValue({ id: 'd-1' }),
      fail: jest.fn().mockResolvedValue({ id: 'd-1' }),
      refund: jest.fn().mockResolvedValue({ deliveryId: 'd-1', refunded: 5 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compile();
    controller = module.get(AdminController);
  });

  afterEach(() => jest.clearAllMocks());

  // The actor goes FIRST and the delivery id second on all three. Both are strings once
  // the actor is destructured, which is exactly why the order is asserted rather than
  // trusted: `forceCancel(id, actor)` would compile if the shapes ever converge.
  describe('the audited delivery mutations forward the actor, then the id', () => {
    it('force-cancel', async () => {
      await controller.forceCancel(ACTOR, 'd-1');
      expect(admin.forceCancel).toHaveBeenCalledWith(ACTOR, 'd-1');
    });

    it('fail — unwrapping the reason out of the body', async () => {
      await controller.fail(ACTOR, 'd-1', {
        reason: DeliveryFailureReason.WEATHER_ABORT,
      });
      expect(admin.fail).toHaveBeenCalledWith(
        ACTOR,
        'd-1',
        DeliveryFailureReason.WEATHER_ABORT,
      );
    });

    it('refund — unwrapping the amount out of the body', async () => {
      await controller.refund(ACTOR, 'd-1', { amount: 5 });
      expect(admin.refund).toHaveBeenCalledWith(ACTOR, 'd-1', 5);
    });
  });

  describe('@AuditActor — the assembly nothing else covers', () => {
    const factory = factoryOf(AuditActor);
    const requestOf = (user: unknown) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as unknown as ExecutionContext;

    it('names the JWT subject as the user and the DB-fresh role as the role', () => {
      // The failure this exists for: with the two fields swapped, every row carries
      // actorUserId 'ADMIN' and a UUID in a Role enum column — Prisma rejects the
      // insert, and because the write is inside the CAS transaction the whole
      // force-cancel rolls back. A 500 on every call, with green CI.
      expect(
        factory(
          undefined,
          requestOf({ sub: 'u-1', email: 'a@b.c', role: Role.ADMIN }),
        ),
      ).toEqual({ userId: 'u-1', role: Role.ADMIN });
    });

    it('carries a non-ADMIN role through unchanged', () => {
      // The delivery routes are ADMIN-only, but the support routes (Task 6) are
      // AGENT-reachable. The role must be read off the request, never assumed.
      expect(
        factory(
          undefined,
          requestOf({ sub: 'agent-9', email: 'a@b.c', role: Role.AGENT }),
        ),
      ).toEqual({ userId: 'agent-9', role: Role.AGENT });
    });

    it('refuses rather than naming an undefined actor when RolesGuard has not run', () => {
      // RolesGuard writes `role`; a route that reaches here without one is missing
      // @Roles. Refusing is strictly better than an audit row that names nobody.
      expect(() =>
        factory(undefined, requestOf({ sub: 'u-1', email: 'a@b.c' })),
      ).toThrow(ForbiddenException);
      expect(() => factory(undefined, requestOf(undefined))).toThrow(
        ForbiddenException,
      );
    });
  });
});
