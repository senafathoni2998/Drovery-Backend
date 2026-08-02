import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { DeliveryFailureReason, Role } from '@prisma/client';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { assembleAuditActor } from './audit/audit-actor.decorator';
import { AdminAuditService } from './audit/admin-audit.service';

describe('AdminController', () => {
  let controller: AdminController;
  let admin: {
    forceCancel: jest.Mock;
    fail: jest.Mock;
    refund: jest.Mock;
    createDrone: jest.Mock;
    updateDrone: jest.Mock;
    createPromo: jest.Mock;
    updatePromo: jest.Mock;
    setRole: jest.Mock;
    issueDroneCommand: jest.Mock;
  };
  let audit: { list: jest.Mock };

  const ACTOR = { userId: 'u-1', role: Role.ADMIN };

  beforeEach(async () => {
    admin = {
      forceCancel: jest.fn().mockResolvedValue({ id: 'd-1' }),
      fail: jest.fn().mockResolvedValue({ id: 'd-1' }),
      refund: jest.fn().mockResolvedValue({ deliveryId: 'd-1', refunded: 5 }),
      createDrone: jest.fn().mockResolvedValue({ id: 'dr-1' }),
      updateDrone: jest.fn().mockResolvedValue({ id: 'dr-1' }),
      createPromo: jest.fn().mockResolvedValue({ id: 'p-1' }),
      updatePromo: jest.fn().mockResolvedValue({ id: 'p-1' }),
      setRole: jest.fn().mockResolvedValue({ id: 'u-2', role: Role.ADMIN }),
      issueDroneCommand: jest.fn().mockResolvedValue({ id: 'c-1' }),
    };
    audit = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: AdminAuditService, useValue: audit },
      ],
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

  // Same shape as the delivery mutations above: the actor goes first, and for the
  // update routes the id comes before the body.
  describe('the audited fleet and promo mutations forward the actor', () => {
    it('createDrone — actor, then the body', async () => {
      const dto = { serial: 'DRV-001' } as any;
      await controller.createDrone(ACTOR, dto);
      expect(admin.createDrone).toHaveBeenCalledWith(ACTOR, dto);
    });

    it('updateDrone — actor, then id, then the body', async () => {
      const dto = { airworthy: false } as any;
      await controller.updateDrone(ACTOR, 'dr-1', dto);
      expect(admin.updateDrone).toHaveBeenCalledWith(ACTOR, 'dr-1', dto);
    });

    it('createPromo — actor, then the body', async () => {
      const dto = { code: 'SAVE10' } as any;
      await controller.createPromo(ACTOR, dto);
      expect(admin.createPromo).toHaveBeenCalledWith(ACTOR, dto);
    });

    it('updatePromo — actor, then id, then the body', async () => {
      const dto = { discountValue: 25 } as any;
      await controller.updatePromo(ACTOR, 'p-1', dto);
      expect(admin.updatePromo).toHaveBeenCalledWith(ACTOR, 'p-1', dto);
    });
  });

  // setRole and issueCommand used to take a bare @CurrentUser('sub') id and throw the
  // role away; both are now the same actor-first shape as the mutations above.
  describe('the audited role and command mutations forward the actor', () => {
    it('setRole — actor, then id, then the extracted role', async () => {
      await controller.setRole(ACTOR, 'u-2', { role: Role.ADMIN } as any);
      expect(admin.setRole).toHaveBeenCalledWith(ACTOR, 'u-2', Role.ADMIN);
    });

    it('issueCommand — actor, then id, then the body', async () => {
      const dto = { type: 'RETURN_TO_BASE' } as any;
      await controller.issueCommand(ACTOR, 'd-1', dto);
      expect(admin.issueDroneCommand).toHaveBeenCalledWith(ACTOR, 'd-1', dto);
    });
  });

  describe('listAudit', () => {
    it('forwards the query to AdminAuditService.list untouched', async () => {
      const query = { page: 2, limit: 10, skip: 10 } as any;
      await controller.listAudit(query);
      expect(audit.list).toHaveBeenCalledWith(query);
    });
  });

  describe('@AuditActor — the assembly nothing else covers', () => {
    // `assembleAuditActor` is the exported plain function `createParamDecorator` calls;
    // testing it directly (Nest's own recommended pattern for custom param decorators)
    // means no dependency on Nest's ROUTE_ARGS_METADATA internals to reach it.
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
        assembleAuditActor(
          requestOf({ sub: 'u-1', email: 'a@b.c', role: Role.ADMIN }),
        ),
      ).toEqual({ userId: 'u-1', role: Role.ADMIN });
    });

    it('carries a non-ADMIN role through unchanged', () => {
      // The delivery routes are ADMIN-only, but the support routes (Task 6) are
      // AGENT-reachable. The role must be read off the request, never assumed.
      expect(
        assembleAuditActor(
          requestOf({ sub: 'agent-9', email: 'a@b.c', role: Role.AGENT }),
        ),
      ).toEqual({ userId: 'agent-9', role: Role.AGENT });
    });

    it('throws a plain Error — not a 403 — when RolesGuard has not run', () => {
      // RolesGuard writes `role`; a route that reaches here without one is missing
      // @Roles — a wiring bug, not denied traffic. A 403 would make the two
      // indistinguishable in logs; a plain Error (Nest turns it into a 500) surfaces
      // it as the programmer error it is.
      expect(() =>
        assembleAuditActor(requestOf({ sub: 'u-1', email: 'a@b.c' })),
      ).toThrow(Error);
      expect(() => assembleAuditActor(requestOf(undefined))).toThrow(Error);
      // Not the domain 403 — HttpException (AppForbiddenException's base) must NOT
      // match, or a regression back to fail-closed-as-403 would slip past this test.
      let caught: unknown;
      try {
        assembleAuditActor(requestOf(undefined));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(HttpException);
    });
  });
});
