import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DeliveriesService } from '../deliveries/deliveries.service';
import { DroneCommandService } from '../deliveries/commands/drone-command.service';
import { PrismaService } from '../prisma/prisma.service';
import { AirspaceService } from '../serviceability/airspace.service';
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
  let airspace: { invalidate: jest.Mock; inForceZones: jest.Mock };
  let recordWithinTx: jest.SpyInstance;

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
    airspace = { invalidate: jest.fn(), inForceZones: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        // The REAL audit service, not a mock. It DOES hold a client of its own — Task 7
        // injected PrismaService for `list()` — so the client each call site HANDS it can
        // no longer be assumed, only asserted. `recordWithinTx(this.prisma, …)` left
        // lexically INSIDE its `$transaction` callback compiles, keeps every row-content
        // assertion here green, and keeps every ordering marker below landing in exactly
        // the right slot (`prisma.adminAuditLog.create` and
        // `prisma.txClient.adminAuditLog.create` are the SAME jest.fn by design). In
        // production it checks out a SECOND pooled connection that autocommits, so the
        // audit row survives a rollback of the very mutation it claims to record. Only
        // the tx IDENTITY separates the two — see `expectAuditedThrough`.
        AdminAuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeliveriesService, useValue: deliveries },
        { provide: WalletService, useValue: wallet },
        { provide: SupportChatPublisher, useValue: publisher },
        { provide: DroneCommandService, useValue: droneCommands },
        { provide: AirspaceService, useValue: airspace },
      ],
    }).compile();
    service = module.get(AdminService);
    // A SPY, not a mock: the real `recordWithinTx` still runs, so every
    // `prisma.adminAuditLog.create` assertion below keeps working unchanged. All the
    // spy adds is a record of WHICH client each call site handed it.
    recordWithinTx = jest.spyOn(
      module.get(AdminAuditService),
      'recordWithinTx',
    );
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Assert the audit row went through the CALLER's transaction client.
   *
   * IDENTITY, not structural equality: `prisma` and `prisma.txClient` share every
   * model mock on purpose (call tracking has to survive the boundary), so the only
   * thing that distinguishes "co-committed inside the caller's transaction" from
   * "written on a second, independently-committing connection" is which OBJECT was
   * passed. The ordering markers cannot see it — they fire on
   * `adminAuditLog.create`, which is the same jest.fn either way.
   *
   * Reported as a label rather than `expect(client).toBe(tx)` because a failing
   * `toBe` here serialises two entire Prisma mocks and buries the one bit that
   * matters under hundreds of lines of `[Function mockConstructor]`.
   */
  const expectAuditedThrough = (tx: unknown, action: string) => {
    expect(recordWithinTx).toHaveBeenCalledTimes(1);
    const [client, entry] = recordWithinTx.mock.calls[0];
    expect(client === tx ? 'the caller tx' : 'a DIFFERENT client').toBe(
      'the caller tx',
    );
    expect(entry).toEqual(expect.objectContaining({ action }));
  };

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
     *  handed, with `prisma.txClient` as the transaction client.
     *
     *  `txClient`, NOT `prisma`: the real `adminForceCancel`/`adminFail` hand over a
     *  genuine `Prisma.TransactionClient`, and handing over `prisma` here would
     *  locally re-alias `tx` to the injected client — making a call site that reached
     *  for `this.prisma` indistinguishable from one that used the tx it was given. */
    const runCallbackFiringFrom = (mock: jest.Mock, firedFrom: string) =>
      mock.mockImplementation(async (...args: any[]) => {
        const audit = args[args.length - 1];
        await audit(prisma.txClient, firedFrom);
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
      // …and through the transaction the delivery service handed over, not a client
      // of the audit service's own.
      expectAuditedThrough(prisma.txClient, 'DELIVERY_FORCE_CANCEL');
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
      expectAuditedThrough(prisma.txClient, 'DELIVERY_FAIL');
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
        const r = await fn(prisma.txClient);
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
      // The order alone cannot see a call site swapped to `this.prisma`: it would
      // still fire between 'credit' and 'commit', because both clients share the
      // same `adminAuditLog.create` jest.fn. Identity can.
      expectAuditedThrough(prisma.txClient, 'DELIVERY_REFUND');
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

    it('records a hand-edited battery level rather than a row that reads "changed nothing"', async () => {
      // batteryPercent was the one UpdateDroneDto field with no allowlist entry, and
      // the result was worse than a missing field: pickAllowed returns `undefined`
      // when nothing survives, so a battery-only edit produced before AND after as
      // NULL — an audit row asserting an operator touched the aircraft and changed
      // nothing. It is also the most consequential value on the row: flight-
      // feasibility derates usable range by it and blocks dispatch below a floor, so
      // raising it by hand is exactly the edit that makes an aircraft look
      // dispatchable on a mission it cannot finish.
      prisma.drone.findUnique.mockResolvedValue({
        id: 'drone-7',
        serial: 'DRV-001',
        airworthy: true,
        status: 'AVAILABLE',
        batteryPercent: 11,
      });
      prisma.drone.update.mockResolvedValue({
        id: 'drone-7',
        serial: 'DRV-001',
        airworthy: true,
        status: 'AVAILABLE',
        batteryPercent: 98,
      });

      await service.updateDrone(actor, 'drone-7', {
        batteryPercent: 98,
      } as any);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DRONE_UPDATE',
          targetId: 'drone-7',
          before: { batteryPercent: 11 },
          after: { batteryPercent: 98 },
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
        const r = await fn(prisma.txClient);
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
      expectAuditedThrough(prisma.txClient, 'DRONE_UPDATE');
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
        const r = await fn(prisma.txClient);
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
      expectAuditedThrough(prisma.txClient, 'PROMO_UPDATE');
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
        firmwareVersion: '2.4.1',
        maxPayloadKg: 3,
        rangeKm: 20,
        homeBaseLat: 1,
        homeBaseLng: 2,
      });

      await service.createDrone(actor, {
        serial: 'X9',
        model: 'Drovery X9',
        firmwareVersion: '2.4.1',
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
            // DRONE_UPDATE allowlisted firmwareVersion from the start and
            // DRONE_CREATE did not, so the firmware an airframe was REGISTERED with
            // was the one point in its history nothing recorded.
            firmwareVersion: '2.4.1',
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
        const r = await fn(prisma.txClient);
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
      expectAuditedThrough(prisma.txClient, 'DRONE_CREATE');
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
        minOrderTotal: 0,
        maxDiscount: 25,
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
        maxRedemptions: null,
        endsAt: null,
      });

      await service.createPromo(actor, {
        code: 'save10',
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscount: 25,
        startsAt: '2026-09-01T00:00:00.000Z',
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
            // The three below were absent from the allowlist while PROMO_UPDATE
            // already carried two of them. `maxDiscount` is the one that matters:
            // it caps a PERCENT promo's dollar exposure, so a promo created uncapped
            // at 90% used to record the 90 and nothing about the missing cap.
            minOrderTotal: 0,
            maxDiscount: 25,
            // A Date on the row, ISO in the log — normalize() keeps a JSONB round
            // trip comparing equal to what went in.
            startsAt: '2026-09-01T00:00:00.000Z',
            maxRedemptions: null,
            endsAt: null,
          },
        }),
      });
    });

    it('runs the audit write inside the SAME transaction as promoCode.create, not after it', async () => {
      // Same defect class as createDrone's equivalent test: "promoCode.create
      // happened AND adminAuditLog.create happened" is satisfied just as well by an
      // audit write hoisted to run right after `$transaction` resolves. Only the
      // ORDER can tell a co-committed write apart from a bolted-on one.
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma.txClient);
        order.push('commit');
        return r;
      });
      prisma.promoCode.create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve({
          id: 'p-9',
          code: 'SAVE10',
          discountType: 'PERCENT',
          discountValue: 10,
          maxRedemptions: null,
          endsAt: null,
        });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.createPromo(actor, {
        code: 'save10',
        discountType: 'PERCENT',
        discountValue: 10,
      } as any);

      expect(order).toEqual(['begin', 'create', 'audit', 'commit']);
      expectAuditedThrough(prisma.txClient, 'PROMO_CREATE');
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
        const r = await fn(prisma.txClient);
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
      expectAuditedThrough(prisma.txClient, 'USER_ROLE_SET');
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
        const r = await fn(prisma.txClient);
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
      expectAuditedThrough(prisma.txClient, 'SUPPORT_TICKET_REPLY');
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
        const r = await fn(prisma.txClient);
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
      expectAuditedThrough(prisma.txClient, 'SUPPORT_TICKET_STATUS_SET');
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
          // `txClient`, not `prisma` — see runCallbackFiringFrom's note. The real
          // DroneCommandService.issue hands over its own transaction client.
          if (audit) await audit(prisma.txClient, command);
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
      expectAuditedThrough(prisma.txClient, 'DRONE_COMMAND_ISSUE');
    });
  });

  describe('airspace zones', () => {
    const ACTOR = { userId: 'admin-1', role: 'ADMIN' as const };

    it('rejects a window that closes before it opens', async () => {
      // Unlike the audit-log query's inverted range, which returns an empty 200, this
      // one is a 400: it silently creates a zone that is never in force, which on an
      // airspace surface reads as protection that does not exist.
      await expect(
        service.createAirspaceZone(ACTOR, {
          name: 'Bad TFR',
          kind: 'TEMPORARY',
          lat: -6.9,
          lng: 107.6,
          radiusKm: 2,
          activeFrom: '2026-09-02T00:00:00Z',
          activeUntil: '2026-09-01T00:00:00Z',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.airspaceZone.create).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    /** The rejection itself, so a test can name WHICH 400 it expects. */
    const rejectionOf = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => {
          throw new Error('expected a rejection, got a resolved promise');
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      return (err as BadRequestException).getResponse();
    };

    it('rejects a CREATE whose window is entirely in the past', async () => {
      // Not inverted — 2019 does open before 2020 — so the inverted-window check waves it
      // through, and what is stored is a zone that can never be in force. On an airspace
      // surface that reads as protection that does not exist, which is the same hazard
      // the inverted-window 400 exists for, arriving by a different door.
      expect(
        await rejectionOf(
          service.createAirspaceZone(ACTOR, {
            name: 'Expired TFR',
            kind: 'TEMPORARY',
            lat: -6.9,
            lng: 107.6,
            radiusKm: 2,
            activeFrom: '2019-01-01T00:00:00Z',
            activeUntil: '2020-01-01T00:00:00Z',
          } as never),
        ),
      ).toMatchObject({ messageKey: 'error.admin.airspace.past_window' });

      expect(prisma.airspaceZone.create).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('rejects a lone past activeUntil patched onto a zone whose stored activeFrom is null', async () => {
      // The reproduced hole, exactly. The inverted-window check fires only when BOTH
      // bounds are present, and every seeded airport stores `activeFrom: null` — so
      // `PATCH /admin/airspace/<CGK id> {"activeUntil":"2020-01-01T00:00:00Z"}` was a
      // 200. Soekarno-Hatta leaves force on the next cache refresh while
      // `GET /admin/airspace` still reports `active: true`. A single ADMIN PATCH,
      // silently reopening protected airspace.
      //
      // The messageKey assertion is load-bearing: a `BadRequestException` alone would
      // also be satisfied by the inverted-window guard, which is precisely the check
      // that does NOT fire here.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-cgk',
        activeFrom: null,
        activeUntil: null,
        floorM: null,
        ceilingM: null,
        active: true,
      });

      expect(
        await rejectionOf(
          service.updateAirspaceZone(ACTOR, 'z-cgk', {
            activeUntil: '2020-01-01T00:00:00Z',
          } as never),
        ),
      ).toMatchObject({ messageKey: 'error.admin.airspace.past_window' });

      expect(prisma.airspaceZone.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
      expect(airspace.invalidate).not.toHaveBeenCalled();
    });

    it('accepts a window that is still open, and one that has not started', async () => {
      // The guard must reject only the already-expired. Relative to Date.now(), not a
      // calendar literal: a hardcoded "future" date turns this test into a time bomb that
      // starts failing on a date nobody wrote down.
      const soon = new Date(Date.now() + 86_400_000).toISOString();
      const later = new Date(Date.now() + 172_800_000).toISOString();
      prisma.airspaceZone.create.mockResolvedValue({ id: 'z-1', active: true });

      await expect(
        service.createAirspaceZone(ACTOR, {
          name: 'Pre-staged TFR',
          kind: 'TEMPORARY',
          lat: -6.9,
          lng: 107.6,
          radiusKm: 2,
          activeFrom: soon,
          activeUntil: later,
        } as never),
      ).resolves.toBeDefined();
      expect(prisma.airspaceZone.create).toHaveBeenCalled();
    });

    it('still allows an edit that does not touch the window of an already-expired zone', async () => {
      // The line the guard must not cross. An expired window is the normal resting state
      // of every TFR that has run its course, and those rows are deliberately kept as the
      // record of why a past delivery was refused. Gating on the merged values
      // unconditionally would 400 an operator fixing a typo in the notes of a zone that
      // closed last week — bricking the history this surface exists to preserve.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-old',
        activeFrom: new Date('2019-01-01T00:00:00.000Z'),
        activeUntil: new Date('2020-01-01T00:00:00.000Z'),
        floorM: null,
        ceilingM: null,
        active: true,
        notes: 'typo',
      });
      prisma.airspaceZone.update.mockResolvedValue({
        id: 'z-old',
        notes: 'corrected',
      });

      await expect(
        service.updateAirspaceZone(ACTOR, 'z-old', {
          notes: 'corrected',
        } as never),
      ).resolves.toBeDefined();
      expect(prisma.airspaceZone.update).toHaveBeenCalled();
    });

    it('rejects a floor above its ceiling', async () => {
      await expect(
        service.createAirspaceZone(ACTOR, {
          name: 'Inverted',
          kind: 'EVENT',
          lat: -6.9,
          lng: 107.6,
          radiusKm: 2,
          floorM: 500,
          ceilingM: 100,
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.airspaceZone.create).not.toHaveBeenCalled();
    });

    it('records a created zone from the stored row and invalidates the cache', async () => {
      // The mocked row deliberately DISAGREES with the DTO on two fields — radiusKm
      // 3.5 against the submitted 3, and activeFrom as a Date where the DTO carried a
      // second-precision string. Contrived on purpose, the same construction setRole
      // uses: with a fixture that echoes the DTO on every field the two SOURCES are
      // indistinguishable, and `args: pickAllowed(..., dto)` passes. That invariant is
      // the first one the brief names, and it was asserted only by a comment.
      prisma.airspaceZone.create.mockResolvedValue({
        id: 'z-9',
        name: 'Bandung Air Show',
        kind: 'EVENT',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 3.5,
        floorM: null,
        ceilingM: null,
        activeFrom: new Date('2026-09-01T00:00:00.000Z'),
        activeUntil: null,
        active: true,
      });

      await service.createAirspaceZone(ACTOR, {
        name: 'Bandung Air Show',
        kind: 'EVENT',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 3,
        activeFrom: '2026-09-01T00:00:00Z',
      } as never);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AIRSPACE_ZONE_CREATE',
          targetType: 'AIRSPACE_ZONE',
          targetId: 'z-9',
          args: expect.objectContaining({
            name: 'Bandung Air Show',
            // The STORED radius, not the requested one.
            radiusKm: 3.5,
            // A Date on the row, ISO in the log — normalize() keeps a JSONB round trip
            // comparing equal. Sourcing from the DTO would record '2026-09-01T00:00:00Z'.
            activeFrom: '2026-09-01T00:00:00.000Z',
          }),
        }),
      });
      // A new restriction that is not live until a TTL expires is a restriction that
      // is not enforced.
      expect(airspace.invalidate).toHaveBeenCalled();
    });

    it('deactivates rather than deleting', async () => {
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        active: true,
      });
      prisma.airspaceZone.update.mockResolvedValue({
        id: 'z-9',
        active: false,
      });

      await service.deactivateAirspaceZone(ACTOR, 'z-9');

      // A zone that once existed is part of why a past delivery was refused.
      expect(prisma.airspaceZone.delete).not.toHaveBeenCalled();
      expect(prisma.airspaceZone.update.mock.calls[0][0].data).toMatchObject({
        active: false,
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AIRSPACE_ZONE_DEACTIVATE',
          before: { active: true },
          after: { active: false },
        }),
      });
    });

    it('reports the STORED active flag, not the value it asked for', async () => {
      // The mock resolves `active: true` — contrived, since deactivate writes
      // `{ active: false }`. An implementation sourcing `after` from that literal
      // instead of from the row Prisma handed back records `false` and no assertion in
      // this file catches it, because every other fixture agrees with the intent. Same
      // construction as setRole's 'after sourced from the UPDATED ROW'.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        active: true,
      });
      prisma.airspaceZone.update.mockResolvedValue({ id: 'z-9', active: true });

      await service.deactivateAirspaceZone(ACTOR, 'z-9');

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AIRSPACE_ZONE_DEACTIVATE',
          after: { active: true },
        }),
      });
    });

    it('rejects an explicit null on a column that cannot hold one', async () => {
      // `@IsOptional()` skips validation for `null` as well as `undefined`, and
      // `whitelist: true` keeps the property, so `{"active": null}` reaches the service
      // unvalidated. `active`, `name` and `radiusKm` are NOT NULL, and letting a null
      // through to Prisma raises an unmapped PrismaClientValidationError — a 500 for a
      // malformed request. It is a 400, and it names the fields.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        activeFrom: null,
        activeUntil: null,
        floorM: null,
        ceilingM: null,
        active: true,
      });

      await expect(
        service.updateAirspaceZone(ACTOR, 'z-9', { active: null } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.airspaceZone.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('never hands Prisma a null for a NOT NULL column', async () => {
      // The write-side half of the same guard. Asserts on the `data` actually built,
      // so a future edit that drops the 400 but keeps `!= null` still fails loudly
      // rather than 500ing.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        activeFrom: null,
        activeUntil: null,
        floorM: null,
        ceilingM: null,
        active: true,
      });

      await expect(
        service.updateAirspaceZone(ACTOR, 'z-9', {
          name: null,
          radiusKm: null,
          active: null,
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.airspaceZone.update).not.toHaveBeenCalled();
    });

    it('still clears a NULLABLE bound when the patch says null', async () => {
      // The other side of the line: `floorM`, `ceilingM`, the window pair and `notes`
      // ARE nullable, and an explicit null there means "unset this", which the guard
      // must not swallow. Without this, tightening the six above to `!= null` could be
      // over-applied to all eleven and nothing would notice.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        activeFrom: null,
        activeUntil: null,
        floorM: 100,
        ceilingM: 500,
        active: true,
      });
      prisma.airspaceZone.update.mockResolvedValue({ id: 'z-9', active: true });

      await service.updateAirspaceZone(ACTOR, 'z-9', {
        ceilingM: null,
      } as never);

      expect(prisma.airspaceZone.update.mock.calls[0][0].data).toEqual({
        ceilingM: null,
      });
    });

    it('rejects a window whose ends coincide, and a zone of zero height', async () => {
      // `>=`, not `>`. A window in force for a single instant and a floor level with
      // its ceiling are both stated decisions, and both are almost certainly a typo.
      const base = {
        name: 'Coincident',
        kind: 'EVENT',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 2,
      };

      await expect(
        service.createAirspaceZone(ACTOR, {
          ...base,
          activeFrom: '2026-09-01T00:00:00Z',
          activeUntil: '2026-09-01T00:00:00Z',
        } as never),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createAirspaceZone(ACTOR, {
          ...base,
          floorM: 300,
          ceilingM: 300,
        } as never),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.airspaceZone.create).not.toHaveBeenCalled();
    });

    it('writes no audit row when the zone does not exist', async () => {
      prisma.airspaceZone.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAirspaceZone(ACTOR, 'missing', { radiusKm: 4 } as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('runs the audit write inside the SAME transaction as the zone create', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma.txClient);
        order.push('commit');
        return r;
      });
      prisma.airspaceZone.create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve({
          id: 'z-9',
          name: 'X',
          kind: 'EVENT',
          lat: 0,
          lng: 0,
          radiusKm: 1,
          active: true,
        });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve({});
      });

      await service.createAirspaceZone(ACTOR, {
        name: 'X',
        kind: 'EVENT',
        lat: 0,
        lng: 0,
        radiusKm: 1,
      } as never);

      expect(order).toEqual(['begin', 'create', 'audit', 'commit']);
    });

    // ── Beyond the brief ──

    it('drops the cache only AFTER the transaction commits, never inside it', async () => {
      // Strictly stronger than "invalidate was called": invalidating INSIDE the
      // transaction drops the cache for a write that may still roll back, and
      // invalidating before the commit races the next reader, which can refill the
      // cache from a snapshot that predates the new zone — and then serve it for a
      // full TTL. Only the position of the marker relative to 'commit' sees that.
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma.txClient);
        order.push('commit');
        return r;
      });
      prisma.airspaceZone.create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve({
          id: 'z-9',
          name: 'X',
          kind: 'EVENT',
          lat: 0,
          lng: 0,
          radiusKm: 1,
          active: true,
        });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve({});
      });
      airspace.invalidate.mockImplementation(() => order.push('invalidate'));

      await service.createAirspaceZone(ACTOR, {
        name: 'X',
        kind: 'EVENT',
        lat: 0,
        lng: 0,
        radiusKm: 1,
      } as never);

      expect(order).toEqual([
        'begin',
        'create',
        'audit',
        'commit',
        'invalidate',
      ]);
      expectAuditedThrough(prisma.txClient, 'AIRSPACE_ZONE_CREATE');
    });

    it('rejects a PATCH whose new activeUntil closes before the STORED activeFrom', async () => {
      // The hole a DTO-only check leaves open. Nothing in this patch is inverted on
      // its own — `activeUntil` alone cannot be — so validating the DTO in isolation
      // waves it through and stores exactly the never-in-force zone the 400 exists to
      // reject. Only the MERGED effective values can see it.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        activeFrom: new Date('2026-09-02T00:00:00.000Z'),
        activeUntil: null,
        floorM: null,
        ceilingM: null,
      });

      await expect(
        service.updateAirspaceZone(ACTOR, 'z-9', {
          activeUntil: '2026-09-01T00:00:00Z',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.airspaceZone.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('rejects a PATCH whose new ceiling sits below the STORED floor', async () => {
      // Same defect class as the window above, on the vertical axis.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        activeFrom: null,
        activeUntil: null,
        floorM: 500,
        ceilingM: null,
      });

      await expect(
        service.updateAirspaceZone(ACTOR, 'z-9', { ceilingM: 100 } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.airspaceZone.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('records a zone edit as a diff sourced from the UPDATED row, then invalidates', async () => {
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        name: 'Bandung Air Show',
        kind: 'EVENT',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 3,
        floorM: null,
        ceilingM: null,
        activeFrom: null,
        activeUntil: null,
        active: true,
      });
      prisma.airspaceZone.update.mockResolvedValue({
        id: 'z-9',
        name: 'Bandung Air Show',
        kind: 'EVENT',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 7,
        floorM: null,
        ceilingM: null,
        activeFrom: null,
        activeUntil: null,
        active: true,
      });

      await service.updateAirspaceZone(ACTOR, 'z-9', {
        radiusKm: 7,
      } as never);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AIRSPACE_ZONE_UPDATE',
          targetType: 'AIRSPACE_ZONE',
          targetId: 'z-9',
          before: { radiusKm: 3 },
          after: { radiusKm: 7 },
        }),
      });
      // Widening a no-fly zone that stays cached for a TTL is a zone that is not
      // enforced at its new radius.
      expect(airspace.invalidate).toHaveBeenCalled();
    });

    it('co-commits the zone edit audit row and invalidates after the commit', async () => {
      const order: string[] = [];
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        radiusKm: 3,
        activeFrom: null,
        activeUntil: null,
        floorM: null,
        ceilingM: null,
        active: true,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma.txClient);
        order.push('commit');
        return r;
      });
      prisma.airspaceZone.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ id: 'z-9', radiusKm: 7, active: true });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve({});
      });
      airspace.invalidate.mockImplementation(() => order.push('invalidate'));

      await service.updateAirspaceZone(ACTOR, 'z-9', { radiusKm: 7 } as never);

      expect(order).toEqual([
        'begin',
        'update',
        'audit',
        'commit',
        'invalidate',
      ]);
      expectAuditedThrough(prisma.txClient, 'AIRSPACE_ZONE_UPDATE');
    });

    it('co-commits the deactivation audit row and invalidates after the commit', async () => {
      const order: string[] = [];
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        active: true,
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma.txClient);
        order.push('commit');
        return r;
      });
      prisma.airspaceZone.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ id: 'z-9', active: false });
      });
      prisma.adminAuditLog.create.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve({});
      });
      airspace.invalidate.mockImplementation(() => order.push('invalidate'));

      await service.deactivateAirspaceZone(ACTOR, 'z-9');

      expect(order).toEqual([
        'begin',
        'update',
        'audit',
        'commit',
        'invalidate',
      ]);
      expectAuditedThrough(prisma.txClient, 'AIRSPACE_ZONE_DEACTIVATE');
    });

    it('404s a deactivation of a zone that does not exist, writing nothing', async () => {
      prisma.airspaceZone.findUnique.mockResolvedValue(null);

      await expect(
        service.deactivateAirspaceZone(ACTOR, 'missing'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.airspaceZone.update).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
      expect(airspace.invalidate).not.toHaveBeenCalled();
    });

    it('records a deactivation that changed nothing rather than a row that says nothing', async () => {
      // `diffAllowed` would emit before: null / after: null here — a row asserting an
      // operator touched the zone and changed nothing, which is the failure the
      // batteryPercent allowlist entry documents as worse than no row at all. The
      // operator DID act; the row must say what state the zone was already in.
      prisma.airspaceZone.findUnique.mockResolvedValue({
        id: 'z-9',
        active: false,
      });
      prisma.airspaceZone.update.mockResolvedValue({
        id: 'z-9',
        active: false,
      });

      await service.deactivateAirspaceZone(ACTOR, 'z-9');

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'AIRSPACE_ZONE_DEACTIVATE',
          before: { active: false },
          after: { active: false },
        }),
      });
    });

    it('lists deactivated zones too — they are the record of a past refusal', async () => {
      prisma.airspaceZone.findMany.mockResolvedValue([]);

      await service.listAirspaceZones();

      // Assert the call HAPPENED first. `mock.calls[0]?.[0] ?? {}` also passes when
      // findMany was never called at all, which is not what this test is about.
      expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(1);
      const args = prisma.airspaceZone.findMany.mock.calls[0][0];
      expect(args.where).toBeUndefined();
      expect(args.orderBy).toEqual([{ active: 'desc' }, { name: 'asc' }]);
    });

    it('reports a computed inForce per zone, which is NOT the operator switch', async () => {
      // `active` is what the operator flipped; `inForce` is whether the router is
      // actually stopping anything. They come apart the moment a window is involved, and
      // a console that shows only `active` reports protection that does not exist — the
      // display half of the PATCH hole above, where the zone left force while
      // `GET /admin/airspace` kept saying `active: true`.
      //
      // Rows `expired` and `pre-staged` are the whole test: both are `active: true` and
      // neither is in force. An implementation that returns `inForce: active` passes on
      // the other two rows and fails on these.
      const now = new Date('2026-08-10T00:00:00.000Z');
      prisma.airspaceZone.findMany.mockResolvedValue([
        { id: 'unbounded', active: true, activeFrom: null, activeUntil: null },
        {
          id: 'expired',
          active: true,
          activeFrom: null,
          activeUntil: new Date('2020-01-01T00:00:00.000Z'),
        },
        {
          id: 'pre-staged',
          active: true,
          activeFrom: new Date('2027-01-01T00:00:00.000Z'),
          activeUntil: null,
        },
        {
          id: 'switched-off',
          active: false,
          activeFrom: null,
          activeUntil: null,
        },
      ]);

      const zones = await service.listAirspaceZones(now);

      expect(zones.map((z) => [z.id, z.active, z.inForce])).toEqual([
        ['unbounded', true, true],
        ['expired', true, false],
        ['pre-staged', true, false],
        ['switched-off', false, false],
      ]);
    });

    it('reads the registry from the PRIMARY, not a replica', async () => {
      // The sibling decision, justified with a concrete hazard and until now unpinned:
      // an operator who has just declared an emergency restriction and reloads the list
      // must see it. Routing this through readWithFallback would let replica lag show
      // them a registry without the zone they just created.
      prisma.airspaceZone.findMany.mockResolvedValue([]);

      await service.listAirspaceZones();

      expect(prisma.readWithFallback).not.toHaveBeenCalled();
    });
  });
});
