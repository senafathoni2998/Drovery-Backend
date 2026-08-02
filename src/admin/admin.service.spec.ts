import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DeliveriesService } from '../deliveries/deliveries.service';
import { DroneCommandService } from '../deliveries/commands/drone-command.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupportChatPublisher } from '../support/chat/support-chat.publisher';
import { WalletService } from '../wallet/wallet.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { AdminService } from './admin.service';
import { AdminAuditService } from './audit/admin-audit.service';

/** Who is acting. The controller assembles it from @CurrentUser, by which point
 *  RolesGuard has written the DB-fresh role onto the request. */
const ACTOR = { userId: 'admin-1', role: 'ADMIN' as const };
/** A DISTINCT role from ACTOR — an agent is not an admin, and a closure that
 *  hardcoded `actorRole: Role.ADMIN` instead of reading `actor.role` would pass
 *  every test that only ever exercises ADMIN. */
const AGENT = { userId: 'agent-1', role: 'AGENT' as const };

describe('AdminService', () => {
  let service: AdminService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let deliveries: { adminForceCancel: jest.Mock; adminFail: jest.Mock };
  let wallet: { creditWithinTx: jest.Mock };
  let publisher: { publishMessage: jest.Mock };
  let droneCommands: { issue: jest.Mock; listForDelivery: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    // adminForceCancel / adminFail own the transaction the audit row co-commits with,
    // and take a callback that AdminService builds and they run INSIDE it. The default
    // mocks never invoke it (most specs here don't care); the audit specs below replace
    // them with one that does, standing in for the transaction. That the real methods
    // run the callback inside the CAS — and hand it the row's exact prior status — is
    // deliveries.service.spec.ts's job, not this file's.
    deliveries = {
      adminForceCancel: jest.fn().mockResolvedValue({ id: 'd-1' }),
      adminFail: jest.fn().mockResolvedValue({ id: 'd-1' }),
    };
    wallet = { creditWithinTx: jest.fn().mockResolvedValue(undefined) };
    publisher = { publishMessage: jest.fn().mockResolvedValue(undefined) };
    droneCommands = {
      issue: jest.fn().mockResolvedValue({ id: 'c-1' }),
      listForDelivery: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        // The REAL audit service, not a mock: it holds no client of its own, so the
        // only thing worth asserting is the row it writes through the tx it is handed.
        AdminAuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeliveriesService, useValue: deliveries },
        { provide: WalletService, useValue: wallet },
        { provide: SupportChatPublisher, useValue: publisher },
        { provide: DroneCommandService, useValue: droneCommands },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('support inbox', () => {
    it('lists ALL tickets (cross-user, no userId filter)', async () => {
      prisma.supportTicket.findMany.mockResolvedValue([]);
      prisma.supportTicket.count.mockResolvedValue(0);
      await service.listTickets({
        status: 'OPEN',
        skip: 0,
        limit: 20,
        page: 1,
      } as any);
      expect(prisma.supportTicket.findMany.mock.calls[0][0].where).toEqual({
        status: 'OPEN',
      });
    });

    it('replies as AGENT (attributed), advances OPEN→IN_PROGRESS, and publishes live', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      const msg = {
        id: 'm-1',
        ticketId: 't-1',
        senderRole: 'AGENT',
        senderUserId: 'agent-1',
        content: 'hi',
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
      };
      prisma.supportChatMessage.create.mockResolvedValue(msg);
      prisma.supportTicket.update.mockResolvedValue({});

      await service.replyAsAgent(AGENT, 't-1', 'hi');

      expect(prisma.supportChatMessage.create).toHaveBeenCalledWith({
        data: {
          ticketId: 't-1',
          senderRole: 'AGENT',
          senderUserId: 'agent-1',
          content: 'hi',
        },
      });
      expect(prisma.supportTicket.update.mock.calls[0][0].data.status).toBe(
        'IN_PROGRESS',
      );
      expect(publisher.publishMessage).toHaveBeenCalled();
    });

    it('rejects replying to a CLOSED ticket', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'CLOSED' });
      await expect(service.replyAsAgent(AGENT, 't-1', 'hi')).rejects.toThrow(
        ConflictException,
      );
      // The guard that stops the mutation must run BEFORE the audit write — a row
      // for a reply that never happened invents an event.
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('404s when the ticket does not exist', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      await expect(
        service.replyAsAgent(AGENT, 't-x', 'hi'),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.supportChatMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('deliveries', () => {
    it('searches deliveries by tracking id, addresses, receiver and customer email', async () => {
      // The console had no search anywhere, so an agent with a customer on the phone
      // quoting a tracking id had to page through 20 rows at a time.
      prisma.readWithFallback.mockResolvedValue([[], 0]);

      await service.listDeliveries({ q: 'A1B2C3D4', limit: 20 } as any);

      const cb = prisma.readWithFallback.mock.calls[0][0];
      const client = {
        $transaction: jest.fn().mockResolvedValue([[], 0]),
        delivery: { findMany: jest.fn(), count: jest.fn() },
      };
      cb(client);
      const where = client.delivery.findMany.mock.calls[0][0].where;
      const fields = where.OR.map(
        (c: Record<string, unknown>) => Object.keys(c)[0],
      );
      expect(fields).toContain('trackingId');
      expect(fields).toContain('receiver');
      expect(where.OR[0].trackingId).toEqual({
        contains: 'A1B2C3D4',
        mode: 'insensitive',
      });
    });

    it('omits the search clause entirely when q is blank', async () => {
      prisma.readWithFallback.mockResolvedValue([[], 0]);

      await service.listDeliveries({ q: '   ', limit: 20 } as any);

      const cb = prisma.readWithFallback.mock.calls[0][0];
      const client = {
        $transaction: jest.fn().mockResolvedValue([[], 0]),
        delivery: { findMany: jest.fn(), count: jest.fn() },
      };
      cb(client);
      expect(
        client.delivery.findMany.mock.calls[0][0].where.OR,
      ).toBeUndefined();
    });

    it('fail delegates to DeliveriesService.adminFail with the given reason', async () => {
      await service.fail(ACTOR, 'd-1', 'WEATHER_ABORT' as any);
      expect(deliveries.adminFail).toHaveBeenCalledWith(
        'd-1',
        'WEATHER_ABORT',
        expect.any(Function),
      );
    });

    it('fail defaults the reason to ADMIN_ABORT when omitted', async () => {
      await service.fail(ACTOR, 'd-1');
      expect(deliveries.adminFail).toHaveBeenCalledWith(
        'd-1',
        'ADMIN_ABORT',
        expect.any(Function),
      );
    });

    it('force-cancel delegates to DeliveriesService.adminForceCancel', async () => {
      await service.forceCancel(ACTOR, 'd-1');
      expect(deliveries.adminForceCancel).toHaveBeenCalledWith(
        'd-1',
        expect.any(Function),
      );
    });

    it('issueDroneCommand delegates to DroneCommandService.issue with the actor id and an audit callback', async () => {
      const dto = { type: 'RETURN_TO_BASE' as any };
      await service.issueDroneCommand(ACTOR, 'd-1', dto);
      expect(droneCommands.issue).toHaveBeenCalledWith(
        'admin-1',
        'd-1',
        dto,
        expect.any(Function),
      );
    });

    it('listDroneCommands delegates to DroneCommandService.listForDelivery', async () => {
      await service.listDroneCommands('d-1');
      expect(droneCommands.listForDelivery).toHaveBeenCalledWith('d-1');
    });

    it('refunds as a wallet credit + marks the payment REFUNDED (single-winner gate)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      await service.refund(ACTOR, 'd-1');
      expect(wallet.creditWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        'u-1',
        18,
        'CHECKOUT_REFUND',
        expect.objectContaining({ idempotencyKey: 'admin-refund:d-1' }),
      );
      // The card charge is flipped only if not already refunded — dedupes against the
      // automatic drone-fault refund channel so a delivery can't be refunded twice.
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1', status: { not: 'REFUNDED' } },
        data: { status: 'REFUNDED' },
      });
    });

    it('rejects (no double-credit) when the payment was already refunded by another channel', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 0 }); // already REFUNDED
      await expect(service.refund(ACTOR, 'd-1')).rejects.toThrow(
        ConflictException,
      );
      expect(wallet.creditWithinTx).not.toHaveBeenCalled();
    });

    it('rejects a refund larger than the charged total', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      await expect(service.refund(ACTOR, 'd-1', 50)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('maps a duplicate refund (P2002) to 409', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      wallet.creditWithinTx.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(service.refund(ACTOR, 'd-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('operator audit — delivery mutations', () => {
    const actor = ACTOR;

    /** Stand in for the transaction the delivery service owns: run the callback it was
     *  handed, with the prisma mock as the transaction client. */
    const runCallbackFiringFrom = (mock: jest.Mock, firedFrom: string) =>
      mock.mockImplementation(async (...args: any[]) => {
        const audit = args[args.length - 1];
        await audit(prisma, firedFrom);
        return { id: 'd-1' };
      });

    it('records who force-cancelled, and the status it fired from', async () => {
      runCallbackFiringFrom(deliveries.adminForceCancel, 'IN_TRANSIT');

      await service.forceCancel(actor, 'd-1');

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          actorRole: 'ADMIN',
          action: 'DELIVERY_FORCE_CANCEL',
          targetType: 'DELIVERY',
          targetId: 'd-1',
          before: { status: 'IN_TRANSIT' },
        }),
      });
    });

    it('records the reason an operator failed a delivery, and what it was flying as', async () => {
      runCallbackFiringFrom(deliveries.adminFail, 'AWAITING_HANDOFF');

      // A DIFFERENT role from the force-cancel test above, deliberately: with ADMIN on
      // both, a closure that hardcoded `actorRole: Role.ADMIN` instead of reading
      // `actor.role` would pass everywhere. The delivery routes are ADMIN-only today,
      // but Task 6 wires the AGENT-reachable support routes through the same closure
      // shape, and a hardcoded role there attributes an agent's action to an admin.
      await service.fail({ userId: 'agent-9', role: 'AGENT' }, 'd-1');

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'agent-9',
          actorRole: 'AGENT',
          action: 'DELIVERY_FAIL',
          targetType: 'DELIVERY',
          targetId: 'd-1',
          before: { status: 'AWAITING_HANDOFF' },
          // The DEFAULTED reason, not the absent one the caller passed — the row has
          // to say what was actually written to the delivery.
          args: { reason: 'ADMIN_ABORT' },
        }),
      });
    });

    it('records the refund amount inside the refund transaction', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 20,
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.refund(actor, 'd-1', 5);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DELIVERY_REFUND',
          targetId: 'd-1',
          args: { amount: 5 },
        }),
      });
    });

    it('writes no audit row when the refund loses its single-winner gate', async () => {
      // The gate exists so a card charge is refunded at most once. An audit row for a
      // refund that did not happen is worse than none — it invents an event.
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 20,
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refund(actor, 'd-1', 5)).rejects.toThrow();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('runs the audit write inside the SAME transaction as the refund credit, not after it', async () => {
      // Same defect class as setRole's equivalent test: "payment flipped AND wallet
      // credited AND audit created" is satisfied just as well by an audit write
      // hoisted to run right after `$transaction` resolves. Only the ORDER tells a
      // co-committed write apart from a bolted-on one.
      const order: string[] = [];
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 20,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.payment.updateMany.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ count: 1 });
      });
      wallet.creditWithinTx.mockImplementation(() => {
        order.push('credit');
        return Promise.resolve(undefined);
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.refund(actor, 'd-1', 5);

      expect(order).toEqual(['begin', 'update', 'credit', 'audit', 'commit']);
    });
  });

  describe('fleet', () => {
    it('registers an aircraft', async () => {
      prisma.drone.create.mockResolvedValue({ id: 'dr-1', serial: 'X1' });

      const out = await service.createDrone(ACTOR, {
        serial: 'X1',
        model: 'Drovery X1',
        maxPayloadKg: 2,
        rangeKm: 15,
        homeBaseLat: -6.9,
        homeBaseLng: 107.6,
      } as any);

      expect(prisma.drone.create).toHaveBeenCalled();
      expect(out).toEqual({ id: 'dr-1', serial: 'X1' });
    });

    it('rejects a duplicate serial with a conflict, not a raw Prisma error', async () => {
      const dup = Object.assign(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      prisma.drone.create.mockRejectedValue(dup);

      await expect(
        service.createDrone(ACTOR, {
          serial: 'X1',
          model: 'm',
          maxPayloadKg: 1,
          rangeKm: 10,
          homeBaseLat: 0,
          homeBaseLng: 0,
        } as any),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('404s an unknown drone rather than returning null', async () => {
      prisma.drone.findUnique.mockResolvedValue(null);
      await expect(service.getDrone('nope')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('grounds an aircraft', async () => {
      // Grounding clears a DISPATCH precondition — it stops the next claim. It does
      // not recall a drone already in the air; that is a RETURN_TO_BASE command.
      prisma.drone.findUnique.mockResolvedValue({ id: 'dr-1', serial: 'X1' });
      prisma.drone.update.mockResolvedValue({
        id: 'dr-1',
        serial: 'X1',
        airworthy: false,
        status: 'GROUNDED',
      });

      await service.updateDrone(ACTOR, 'dr-1', { airworthy: false } as any);

      expect(prisma.drone.update).toHaveBeenCalledWith({
        where: { id: 'dr-1' },
        data: { airworthy: false },
      });
    });

    it('searches the registry by serial and model', async () => {
      prisma.readWithFallback.mockResolvedValue([[], 0]);

      await service.listDrones({ q: 'X1', limit: 20 } as any);

      const cb = prisma.readWithFallback.mock.calls[0][0];
      const client = {
        $transaction: jest.fn().mockResolvedValue([[], 0]),
        drone: { findMany: jest.fn(), count: jest.fn() },
      };
      cb(client);
      const fields = client.drone.findMany.mock.calls[0][0].where.OR.map(
        (c: Record<string, unknown>) => Object.keys(c)[0],
      );
      expect(fields).toEqual(['serial', 'model']);
    });
  });

  describe('promo CRUD', () => {
    it('creates a promo (uppercased code)', async () => {
      prisma.promoCode.create.mockResolvedValue({ id: 'p-1' });
      await service.createPromo(ACTOR, {
        code: 'save10',
        discountType: 'PERCENT',
        discountValue: 10,
      } as any);
      expect(prisma.promoCode.create.mock.calls[0][0].data.code).toBe('SAVE10');
    });

    it('rejects a PERCENT discount over 100', async () => {
      await expect(
        service.createPromo(ACTOR, {
          code: 'X',
          discountType: 'PERCENT',
          discountValue: 150,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a duplicate code (P2002) to 409', async () => {
      prisma.promoCode.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.createPromo(ACTOR, {
          code: 'DUP',
          discountType: 'FIXED',
          discountValue: 5,
        } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('rejects updating a PERCENT promo above 100%', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'p-1',
        discountType: 'PERCENT',
      });
      await expect(
        service.updatePromo(ACTOR, 'p-1', { discountValue: 150 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
    });

    it('applies a valid discountValue update', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'p-1',
        discountType: 'PERCENT',
      });
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      await service.updatePromo(ACTOR, 'p-1', { discountValue: 50 } as any);
      expect(
        prisma.promoCode.updateMany.mock.calls[0][0].data.discountValue,
      ).toBe(50);
    });
  });

  describe('operator audit — fleet and promos', () => {
    const actor = { userId: 'admin-1', role: 'ADMIN' as const };

    it('records the prior airworthiness when an aircraft is grounded', async () => {
      // The question an incident review asks is "was it airworthy before you touched
      // it" — and only a before-value answers that.
      prisma.drone.findUnique.mockResolvedValue({
        id: 'drone-7',
        serial: 'DRV-001',
        airworthy: true,
        status: 'AVAILABLE',
      });
      prisma.drone.update.mockResolvedValue({
        id: 'drone-7',
        serial: 'DRV-001',
        airworthy: false,
        status: 'MAINTENANCE',
      });

      await service.updateDrone(actor, 'drone-7', {
        airworthy: false,
        status: 'MAINTENANCE',
      } as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DRONE_UPDATE',
          targetType: 'DRONE',
          targetId: 'drone-7',
          before: { airworthy: true, status: 'AVAILABLE' },
          after: { airworthy: false, status: 'MAINTENANCE' },
        }),
      });
    });

    it('runs the audit write inside the SAME transaction as drone.update, not after it', async () => {
      // "drone.update happened AND adminAuditLog.create happened" cannot tell a
      // co-committed write apart from one hoisted out to run right after
      // `$transaction` resolves — recordWithinTx calls the SAME `adminAuditLog.create`
      // mock either way, since `tx` and `prisma` share model mocks by design (see
      // createMockPrismaService). Only the ORDER can tell them apart.
      const order: string[] = [];
      prisma.drone.findUnique.mockResolvedValue({
        id: 'drone-7',
        serial: 'DRV-001',
        airworthy: true,
        status: 'AVAILABLE',
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.drone.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({
          id: 'drone-7',
          serial: 'DRV-001',
          airworthy: false,
          status: 'MAINTENANCE',
        });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.updateDrone(actor, 'drone-7', {
        airworthy: false,
        status: 'MAINTENANCE',
      } as any);

      expect(order).toEqual(['begin', 'update', 'audit', 'commit']);
    });

    it('records a promo edit as a diff, not the whole row', async () => {
      prisma.promoCode.findUnique
        .mockResolvedValueOnce({
          id: 'p-1',
          discountType: 'PERCENT',
          discountValue: 10,
          active: true,
        })
        .mockResolvedValue({
          id: 'p-1',
          discountType: 'PERCENT',
          discountValue: 25,
          active: true,
        });
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });

      await service.updatePromo(actor, 'p-1', { discountValue: 25 } as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'PROMO_UPDATE',
          before: { discountValue: 10 },
          after: { discountValue: 25 },
        }),
      });
    });

    it('runs the audit write inside the SAME transaction as promoCode.updateMany, not after it', async () => {
      const order: string[] = [];
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'p-1',
        discountType: 'PERCENT',
        discountValue: 10,
        active: true,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.promoCode.updateMany.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ count: 1 });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.updatePromo(actor, 'p-1', { discountValue: 25 } as any);

      expect(order).toEqual(['begin', 'update', 'audit', 'commit']);
    });

    it('does not record a drone registration that failed on a duplicate serial', async () => {
      // A REAL PrismaClientKnownRequestError, not a look-alike — createDrone's catch
      // guards on `instanceof`, and a plain Error with matching fields would rethrow
      // raw and let this test pass for the wrong reason (it would prove nothing about
      // the P2002 path specifically; only that createDrone doesn't audit on ANY throw).
      prisma.drone.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(
        service.createDrone(actor, { serial: 'DRV-001' } as any),
      ).rejects.toThrow();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('records a DRONE_CREATE row — action, target and args, sourced from the created row', async () => {
      // Positive assertion: nothing else in the file checks that createDrone writes a
      // row at all — deleting the whole audit.recordWithinTx call left every other
      // test green.
      prisma.drone.create.mockResolvedValue({
        id: 'dr-9',
        serial: 'X9',
        model: 'Drovery X9',
        maxPayloadKg: 3,
        rangeKm: 20,
        homeBaseLat: 1,
        homeBaseLng: 2,
      });

      await service.createDrone(actor, {
        serial: 'X9',
        model: 'Drovery X9',
        maxPayloadKg: 3,
        rangeKm: 20,
        homeBaseLat: 1,
        homeBaseLng: 2,
      } as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          actorRole: 'ADMIN',
          action: 'DRONE_CREATE',
          targetType: 'DRONE',
          targetId: 'dr-9',
          args: {
            serial: 'X9',
            model: 'Drovery X9',
            maxPayloadKg: 3,
            rangeKm: 20,
            homeBaseLat: 1,
            homeBaseLng: 2,
          },
        }),
      });
    });

    it('runs the audit write inside the SAME transaction as drone.create, not after it', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.drone.create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve({
          id: 'dr-9',
          serial: 'X9',
          model: 'Drovery X9',
          maxPayloadKg: 3,
          rangeKm: 20,
          homeBaseLat: 1,
          homeBaseLng: 2,
        });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.createDrone(actor, {
        serial: 'X9',
        model: 'Drovery X9',
        maxPayloadKg: 3,
        rangeKm: 20,
        homeBaseLat: 1,
        homeBaseLng: 2,
      } as any);

      expect(order).toEqual(['begin', 'create', 'audit', 'commit']);
    });

    it('records a PROMO_CREATE row sourced from the created row, so the audited code is the normalized one', async () => {
      // Positive assertion (nothing else pins the write) AND the createPromo judgment
      // call: pickAllowed reads the CREATED ROW, not the raw DTO, specifically because
      // `code` is normalized on write (trim + uppercase). Submitting lowercase and
      // asserting uppercase in the audit row pins both at once — reverting the source
      // to `dto` would record 'save10' and fail this test.
      prisma.promoCode.create.mockResolvedValue({
        id: 'p-9',
        code: 'SAVE10',
        discountType: 'PERCENT',
        discountValue: 10,
        maxRedemptions: null,
        endsAt: null,
      });

      await service.createPromo(actor, {
        code: 'save10',
        discountType: 'PERCENT',
        discountValue: 10,
      } as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          actorRole: 'ADMIN',
          action: 'PROMO_CREATE',
          targetType: 'PROMO',
          targetId: 'p-9',
          // maxRedemptions/endsAt come through as explicit null, not omitted: sourcing
          // from the created row (not the DTO) means pickAllowed sees the persisted
          // default, and pickAllowed only skips `undefined`, not `null`.
          args: {
            code: 'SAVE10',
            discountType: 'PERCENT',
            discountValue: 10,
            maxRedemptions: null,
            endsAt: null,
          },
        }),
      });
    });

    it('writes no audit row when updatePromo matches nothing', async () => {
      // Mirrors 'writes no audit row when the refund loses its single-winner gate'.
      // Neither half of this guard was pinned before: the PERCENT>100 test never
      // reaches updateMany, and the valid-update test mocks { count: 1 }. The mock's
      // updateMany default is already { count: 0 } — no override needed.
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'p-1',
        discountType: 'PERCENT',
      });

      await expect(
        service.updatePromo(actor, 'p-1', { discountValue: 50 } as any),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('overview', () => {
    it('shapes the dashboard, backfilling every delivery status to 0', async () => {
      prisma.user.count.mockResolvedValue(7);
      prisma.delivery.groupBy.mockResolvedValue([
        { status: 'DELIVERED', _count: { _all: 3 } },
        { status: 'PENDING', _count: { _all: 2 } },
      ]);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 123.4 } });
      prisma.supportTicket.count.mockResolvedValue(1);
      prisma.recurringDelivery.count.mockResolvedValue(4);

      const result = await service.getOverview();
      expect(result.users).toBe(7);
      expect(result.deliveriesByStatus.DELIVERED).toBe(3);
      expect(result.deliveriesByStatus.CANCELED).toBe(0); // backfilled
      expect(result.revenue).toBe(123.4);
      expect(result.openTickets).toBe(1);
      expect(result.activeRecurringSchedules).toBe(4);
    });
  });

  describe('setRole', () => {
    it('promotes a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
      prisma.user.update.mockResolvedValue({
        id: 'u-2',
        email: 'x',
        role: 'AGENT',
      });
      await service.setRole(ACTOR, 'u-2', 'AGENT' as any);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('refuses to demote the last admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
      prisma.user.count.mockResolvedValue(1);
      await expect(
        service.setRole(ACTOR, 'u-2', 'USER' as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      // The guard runs BEFORE any transaction opens — a row for a demotion that
      // never happened invents an event.
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('404s when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setRole(ACTOR, 'nope', 'ADMIN' as any),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('operator audit — roles, support and commands', () => {
    const actor = ACTOR;
    const agent = AGENT;

    it('records a role change with the prior role, and `after` sourced from the UPDATED ROW', async () => {
      // The mock's update resolves a DIFFERENT role ('AGENT') than the one requested
      // ('ADMIN') — contrived on purpose. An implementation that sourced `after` off
      // the `role` PARAMETER instead of the row Prisma actually wrote would record
      // 'ADMIN' here and this assertion would not catch it; only a mismatch between
      // the request and the mocked write does.
      prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
      prisma.user.update.mockResolvedValue({
        id: 'u-2',
        email: 'a@b.c',
        role: 'AGENT',
      });

      await service.setRole(actor, 'u-2', 'ADMIN' as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'USER_ROLE_SET',
          targetType: 'USER',
          targetId: 'u-2',
          before: { role: 'USER' },
          after: { role: 'AGENT' },
        }),
      });
    });

    it('runs the audit write inside the SAME transaction as user.update, not after it', async () => {
      // "user.update happened AND adminAuditLog.create happened" cannot tell a
      // co-committed write apart from one hoisted out and run right after
      // `$transaction` resolves — a role change that persists with no operator row,
      // while every assertion above stays green (recordWithinTx calls the SAME
      // `adminAuditLog.create` mock either way, since `tx` and `prisma` share model
      // mocks by design — see createMockPrismaService). Only the ORDER can tell them
      // apart.
      const order: string[] = [];
      prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.user.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ id: 'u-2', email: 'a@b.c', role: 'ADMIN' });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.setRole(actor, 'u-2', 'ADMIN' as any);

      expect(order).toEqual(['begin', 'update', 'audit', 'commit']);
    });

    it('records the AGENT role of a support reply, not a blanket ADMIN', async () => {
      // The log records agent actions too, and "which hat were they wearing" is
      // part of the record — an agent is not an admin.
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.supportChatMessage.create.mockResolvedValue({
        id: 'm-1',
        ticketId: 't-1',
        senderRole: 'AGENT',
        content: 'hello',
        createdAt: new Date(),
      });

      await service.replyAsAgent(agent, 't-1', 'hello');

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'agent-1',
          actorRole: 'AGENT',
          action: 'SUPPORT_TICKET_REPLY',
          targetType: 'SUPPORT_TICKET',
          targetId: 't-1',
          args: { contentLength: 5 },
        }),
      });
    });

    it('never stores the text of a support reply', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.supportChatMessage.create.mockResolvedValue({
        id: 'm-1',
        ticketId: 't-1',
        senderRole: 'AGENT',
        content: 'x',
        createdAt: new Date(),
      });

      await service.replyAsAgent(
        agent,
        't-1',
        'my card number is 4111 1111 1111 1111',
      );

      const row = JSON.stringify(prisma.adminAuditLog.create.mock.calls[0][0]);
      expect(row).not.toContain('4111');
    });

    it('runs the audit write inside the SAME transaction as the two support writes, not after it', async () => {
      // Same defect class as setRole's equivalent test above: "message created AND
      // ticket updated AND audit created" is satisfied just as well by an audit
      // write hoisted to run right after `$transaction` resolves. Only the ORDER
      // tells a co-committed write apart from a bolted-on one.
      const order: string[] = [];
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.supportChatMessage.create.mockImplementation(() => {
        order.push('message');
        return Promise.resolve({
          id: 'm-1',
          ticketId: 't-1',
          senderRole: 'AGENT',
          content: 'hi',
          createdAt: new Date(),
        });
      });
      prisma.supportTicket.update.mockImplementation(() => {
        order.push('ticket-update');
        return Promise.resolve({});
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.replyAsAgent(agent, 't-1', 'hi');

      expect(order).toEqual([
        'begin',
        'message',
        'ticket-update',
        'audit',
        'commit',
      ]);
    });

    it('records a support ticket status change with the prior status', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.supportTicket.updateMany.mockResolvedValue({ count: 1 });

      await service.setTicketStatus(actor, 't-1', 'RESOLVED' as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          actorRole: 'ADMIN',
          action: 'SUPPORT_TICKET_STATUS_SET',
          targetType: 'SUPPORT_TICKET',
          targetId: 't-1',
          before: { status: 'OPEN' },
          after: { status: 'RESOLVED' },
        }),
      });
    });

    it('runs the audit write inside the SAME transaction as the status updateMany, not after it', async () => {
      const order: string[] = [];
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.supportTicket.updateMany.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ count: 1 });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.setTicketStatus(actor, 't-1', 'RESOLVED' as any);

      expect(order).toEqual(['begin', 'update', 'audit', 'commit']);
    });

    it('404s and writes no audit row when the ticket does not exist', async () => {
      // Half one of the guard: the pre-read is what lets a missing ticket stay a
      // clean 404 instead of a 0-row updateMany with no way to tell why.
      prisma.supportTicket.findUnique.mockResolvedValue(null);

      await expect(
        service.setTicketStatus(actor, 't-x', 'RESOLVED' as any),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.supportTicket.updateMany).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('writes no audit row when the status update race loses (ticket vanished after the pre-read)', async () => {
      // Half two of the guard: the pre-read can pass and the updateMany still
      // match nothing (a concurrent delete). That must 404 too, and BEFORE the
      // audit call — a row for a status change that never landed invents an event.
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      prisma.supportTicket.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.setTicketStatus(actor, 't-1', 'RESOLVED' as any),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('records who issued a drone command, sourced from the created row', async () => {
      // Positive assertion: DroneCommandService is mocked here, so this only pins
      // that AdminService wires actor + the created row through pickAllowed into
      // the callback it hands to `issue` — DroneCommandService.issue actually
      // running that callback inside its own transaction is
      // drone-command.service.spec.ts's job.
      droneCommands.issue.mockImplementation(
        async (
          _adminId: string | null,
          _deliveryId: string,
          dto: any,
          audit?: (tx: unknown, command: unknown) => Promise<void>,
        ) => {
          const command = {
            id: 'c-1',
            type: dto.type,
            reason: 'WEATHER_ABORT',
          };
          if (audit) await audit(prisma, command);
          return command;
        },
      );

      await service.issueDroneCommand(actor, 'd-1', {
        type: 'RETURN_TO_BASE',
      } as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          actorRole: 'ADMIN',
          action: 'DRONE_COMMAND_ISSUE',
          targetType: 'DELIVERY',
          targetId: 'd-1',
          args: { type: 'RETURN_TO_BASE', reason: 'WEATHER_ABORT' },
        }),
      });
    });
  });
});
