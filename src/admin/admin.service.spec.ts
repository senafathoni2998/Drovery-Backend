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

      await service.replyAsAgent('agent-1', 't-1', 'hi');

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
      await expect(service.replyAsAgent('a', 't-1', 'hi')).rejects.toThrow(
        ConflictException,
      );
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

    it('issueDroneCommand delegates to DroneCommandService.issue with the admin id', async () => {
      const dto = { type: 'RETURN_TO_BASE' as any };
      await service.issueDroneCommand('admin-1', 'd-1', dto);
      expect(droneCommands.issue).toHaveBeenCalledWith('admin-1', 'd-1', dto);
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
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
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
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 20,
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refund(actor, 'd-1', 5)).rejects.toThrow();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
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
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
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

    it('records a promo edit as a diff, not the whole row', async () => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
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

    it('does not record a drone registration that failed on a duplicate serial', async () => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
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
      await service.setRole('admin-1', 'u-2', 'AGENT' as any);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('refuses to demote the last admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
      prisma.user.count.mockResolvedValue(1);
      await expect(
        service.setRole('admin-1', 'u-2', 'USER' as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
