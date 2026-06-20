import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  DroneCommandStatus,
  DroneCommandType,
  Prisma,
  TrackingSource,
} from '@prisma/client';

import { createMockPrismaService } from '../../test/prisma-mock';
import { DroneCommandService } from './drone-command.service';
import { COMMAND_TTL_MS } from './command.constants';

describe('DroneCommandService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let deliveries: {
    beginReturnToBase: jest.Mock;
    failExceptional: jest.Mock;
  };
  let metrics: {
    droneCommandsTotal: { inc: jest.Mock };
    droneCommandTimeToAck: { observe: jest.Mock };
  };
  let mqtt: { publish: jest.Mock };
  let service: DroneCommandService;

  const DRONE = 'drone-1';
  const future = () => new Date(Date.now() + COMMAND_TTL_MS);
  // drone_commands is partitioned by deliveryCreatedAt (the parent's createdAt); the ack
  // flow threads it into the composite-PK update.
  const DCA = new Date('2026-06-01T00:00:00.000Z');

  beforeEach(() => {
    prisma = createMockPrismaService();
    deliveries = {
      beginReturnToBase: jest.fn().mockResolvedValue(true),
      failExceptional: jest.fn().mockResolvedValue(true),
    };
    metrics = {
      droneCommandsTotal: { inc: jest.fn() },
      droneCommandTimeToAck: { observe: jest.fn() },
    };
    prisma.droneCommand.count.mockResolvedValue(0); // under the per-delivery cap
    mqtt = { publish: jest.fn() };
    service = new DroneCommandService(
      prisma as any,
      deliveries as any,
      metrics as any,
      mqtt as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  const liveDelivery = (over: Record<string, unknown> = {}) => ({
    id: 'd-1',
    status: DeliveryStatus.IN_TRANSIT,
    trackingSource: TrackingSource.LIVE,
    assignedDroneId: DRONE,
    ...over,
  });

  // ── issue ──
  describe('issue', () => {
    it('rejects a SIMULATED delivery (422 — no real drone)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(
        liveDelivery({ trackingSource: TrackingSource.SIMULATED }),
      );
      await expect(
        service.issue('admin-1', 'd-1', {
          type: DroneCommandType.RETURN_TO_BASE,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.droneCommand.create).not.toHaveBeenCalled();
    });

    it('rejects a missing delivery (404)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);
      await expect(
        service.issue('admin-1', 'd-x', { type: DroneCommandType.ABORT }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a delivery with no assigned drone (409)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(
        liveDelivery({ assignedDroneId: null }),
      );
      await expect(
        service.issue('admin-1', 'd-1', { type: DroneCommandType.ABORT }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects RETURN_TO_BASE before pickup (DRONE_ASSIGNED not RETURNABLE) → 409', async () => {
      prisma.delivery.findUnique.mockResolvedValue(
        liveDelivery({ status: DeliveryStatus.DRONE_ASSIGNED }),
      );
      await expect(
        service.issue('admin-1', 'd-1', {
          type: DroneCommandType.RETURN_TO_BASE,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows ABORT pre-pickup (DRONE_ASSIGNED is FAILABLE) with default reason ADMIN_ABORT', async () => {
      prisma.delivery.findUnique.mockResolvedValue(
        liveDelivery({ status: DeliveryStatus.DRONE_ASSIGNED }),
      );
      prisma.droneCommand.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'c-1', status: 'PENDING', ...args.data }),
      );
      await service.issue('admin-1', 'd-1', { type: DroneCommandType.ABORT });
      const data = prisma.droneCommand.create.mock.calls[0][0].data;
      expect(data.reason).toBe(DeliveryFailureReason.ADMIN_ABORT);
      expect(data.droneId).toBe(DRONE);
      expect(data.issuedByUserId).toBe('admin-1');
      expect(data.expiresAt).toBeInstanceOf(Date);
      expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith({
        type: DroneCommandType.ABORT,
        result: 'issued',
      });
    });

    it('PUSHES the new command to the drone over MQTT (best-effort)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(liveDelivery());
      prisma.droneCommand.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'c-1', ...args.data }),
      );
      await service.issue('admin-1', 'd-1', {
        type: DroneCommandType.RETURN_TO_BASE,
      });
      expect(mqtt.publish).toHaveBeenCalledWith(
        'drovery/commands/drone-1',
        expect.objectContaining({ id: 'c-1', droneId: DRONE }),
      );
    });

    it('a throwing MQTT publish does NOT fail issue() (fail-open)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(liveDelivery());
      prisma.droneCommand.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'c-1', ...args.data }),
      );
      mqtt.publish.mockImplementation(() => {
        throw new Error('broker down');
      });
      const cmd = await service.issue('admin-1', 'd-1', {
        type: DroneCommandType.ABORT,
      });
      expect((cmd as any).id).toBe('c-1'); // issue still succeeds
    });

    it('defaults RETURN_TO_BASE reason to WEATHER_ABORT and honors an explicit override', async () => {
      prisma.delivery.findUnique.mockResolvedValue(liveDelivery());
      prisma.droneCommand.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'c-1', ...args.data }),
      );
      await service.issue('admin-1', 'd-1', {
        type: DroneCommandType.RETURN_TO_BASE,
      });
      expect(prisma.droneCommand.create.mock.calls[0][0].data.reason).toBe(
        DeliveryFailureReason.WEATHER_ABORT,
      );

      await service.issue('admin-1', 'd-1', {
        type: DroneCommandType.RETURN_TO_BASE,
        reason: DeliveryFailureReason.RECIPIENT_UNAVAILABLE,
      });
      expect(prisma.droneCommand.create.mock.calls[1][0].data.reason).toBe(
        DeliveryFailureReason.RECIPIENT_UNAVAILABLE,
      );
    });

    it('maps the partial-unique P2002 to a 409 (a command is already open)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(liveDelivery());
      prisma.droneCommand.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '7.0.0',
        }),
      );
      await expect(
        service.issue('admin-1', 'd-1', {
          type: DroneCommandType.RETURN_TO_BASE,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects once the per-delivery command cap is reached (409, no insert)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(liveDelivery());
      prisma.droneCommand.count.mockResolvedValue(50); // at MAX_COMMANDS_PER_DELIVERY
      await expect(
        service.issue('admin-1', 'd-1', { type: DroneCommandType.ABORT }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.droneCommand.create).not.toHaveBeenCalled();
    });
  });

  // ── fetchPending ──
  describe('fetchPending', () => {
    it('returns null when the drone has no open command', async () => {
      prisma.droneCommand.findFirst.mockResolvedValue(null);
      await expect(service.fetchPending(DRONE)).resolves.toEqual({
        command: null,
      });
    });

    it('returns null (no leak) when the matched command’s delivery is not this drone / not LIVE', async () => {
      prisma.droneCommand.findFirst.mockResolvedValue({
        id: 'c-1',
        droneId: DRONE,
        type: DroneCommandType.RETURN_TO_BASE,
        status: DroneCommandStatus.PENDING,
        delivery: {
          trackingSource: TrackingSource.LIVE,
          assignedDroneId: 'other-drone',
        },
      });
      await expect(service.fetchPending(DRONE)).resolves.toEqual({
        command: null,
      });
      expect(prisma.droneCommand.updateMany).not.toHaveBeenCalled();
    });

    it('transitions PENDING → FETCHED and counts a fetch', async () => {
      prisma.droneCommand.findFirst.mockResolvedValue({
        id: 'c-1',
        deliveryId: 'd-1',
        droneId: DRONE,
        type: DroneCommandType.RETURN_TO_BASE,
        reason: DeliveryFailureReason.WEATHER_ABORT,
        status: DroneCommandStatus.PENDING,
        expiresAt: future(),
        createdAt: new Date(),
        delivery: {
          trackingSource: TrackingSource.LIVE,
          assignedDroneId: DRONE,
        },
      });
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 1 });
      const { command } = await service.fetchPending(DRONE);
      expect(command?.status).toBe(DroneCommandStatus.FETCHED);
      expect(prisma.droneCommand.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: DroneCommandStatus.PENDING },
        data: expect.objectContaining({ status: DroneCommandStatus.FETCHED }),
      });
      expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith({
        type: DroneCommandType.RETURN_TO_BASE,
        result: 'fetched',
      });
    });

    it('hands the drone NOTHING if the PENDING→FETCHED CAS lost to a concurrent expiry', async () => {
      // findFirst saw it PENDING, but between read and CAS the watchdog expired it:
      // the CAS matches 0 rows and a re-read shows it is no longer FETCHED.
      // Both reads in fetchPending are findFirst (the queue poll AND the post-CAS re-read
      // by id) — stub them distinctly with Once/Once so the re-read genuinely returns
      // EXPIRED (a single mockResolvedValue would answer BOTH calls with the poll row,
      // exercising the branch only by coincidence).
      prisma.droneCommand.findFirst
        .mockResolvedValueOnce({
          id: 'c-1',
          deliveryId: 'd-1',
          droneId: DRONE,
          type: DroneCommandType.RETURN_TO_BASE,
          reason: DeliveryFailureReason.WEATHER_ABORT,
          status: DroneCommandStatus.PENDING,
          expiresAt: future(),
          createdAt: new Date(),
          delivery: {
            trackingSource: TrackingSource.LIVE,
            assignedDroneId: DRONE,
          },
        })
        .mockResolvedValueOnce({ status: DroneCommandStatus.EXPIRED }); // re-read: no longer FETCHED
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 0 }); // lost the CAS
      await expect(service.fetchPending(DRONE)).resolves.toEqual({
        command: null,
      });
      expect(metrics.droneCommandsTotal.inc).not.toHaveBeenCalled();
    });

    it('re-poll of an already-FETCHED command returns it without re-counting a fetch', async () => {
      prisma.droneCommand.findFirst.mockResolvedValue({
        id: 'c-1',
        deliveryId: 'd-1',
        droneId: DRONE,
        type: DroneCommandType.ABORT,
        reason: DeliveryFailureReason.ADMIN_ABORT,
        status: DroneCommandStatus.FETCHED,
        expiresAt: future(),
        createdAt: new Date(),
        delivery: {
          trackingSource: TrackingSource.LIVE,
          assignedDroneId: DRONE,
        },
      });
      const { command } = await service.fetchPending(DRONE);
      expect(command?.status).toBe(DroneCommandStatus.FETCHED);
      expect(prisma.droneCommand.updateMany).not.toHaveBeenCalled();
      expect(metrics.droneCommandsTotal.inc).not.toHaveBeenCalled();
    });
  });

  // ── ack ──
  describe('ack', () => {
    const fetched = (over: Record<string, unknown> = {}) => ({
      id: 'c-1',
      deliveryId: 'd-1',
      deliveryCreatedAt: DCA,
      droneId: DRONE,
      type: DroneCommandType.RETURN_TO_BASE,
      reason: DeliveryFailureReason.WEATHER_ABORT,
      status: DroneCommandStatus.FETCHED,
      expiresAt: future(),
      createdAt: new Date(Date.now() - 2000),
      delivery: {
        trackingSource: TrackingSource.LIVE,
        assignedDroneId: DRONE,
      },
      ...over,
    });

    it('404 on an unknown command', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(null);
      await expect(service.ack('c-x', DRONE, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('403 when the acking drone is not the bound drone', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(fetched());
      await expect(service.ack('c-1', 'stranger', true)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(deliveries.beginReturnToBase).not.toHaveBeenCalled();
    });

    it('409 + marks EXPIRED when the command TTL has already passed', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(
        fetched({ expiresAt: new Date(Date.now() - 1000) }),
      );
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.ack('c-1', DRONE, true)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.droneCommand.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'c-1',
          status: {
            in: [DroneCommandStatus.PENDING, DroneCommandStatus.FETCHED],
          },
        },
        data: { status: DroneCommandStatus.EXPIRED },
      });
      expect(deliveries.beginReturnToBase).not.toHaveBeenCalled();
      // The lazy expiry is counted under the real type (not only the watchdog sweep).
      expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith({
        type: DroneCommandType.RETURN_TO_BASE,
        result: 'expired',
      });
    });

    it('409 on a duplicate/replayed ack (claim CAS matches nothing)', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(fetched());
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 0 }); // already acked
      await expect(service.ack('c-1', DRONE, true)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(deliveries.beginReturnToBase).not.toHaveBeenCalled();
    });

    it('accepted RETURN_TO_BASE drives beginReturnToBase with the command reason and marks appliedTransition', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(fetched());
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 1 });
      deliveries.beginReturnToBase.mockResolvedValue(true);
      const res = await service.ack('c-1', DRONE, true);
      expect(deliveries.beginReturnToBase).toHaveBeenCalledWith(
        'd-1',
        DeliveryFailureReason.WEATHER_ABORT,
      );
      expect(res).toEqual({
        id: 'c-1',
        status: DroneCommandStatus.ACKED,
        appliedTransition: true,
      });
      expect(prisma.droneCommand.update).toHaveBeenCalledWith({
        where: { id_deliveryCreatedAt: { id: 'c-1', deliveryCreatedAt: DCA } },
        data: { appliedTransition: true },
      });
      expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith({
        type: DroneCommandType.RETURN_TO_BASE,
        result: 'acked',
      });
      expect(metrics.droneCommandTimeToAck.observe).toHaveBeenCalled();
    });

    it('accepted ABORT drives failExceptional', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(
        fetched({
          type: DroneCommandType.ABORT,
          reason: DeliveryFailureReason.ADMIN_ABORT,
        }),
      );
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 1 });
      await service.ack('c-1', DRONE, true);
      expect(deliveries.failExceptional).toHaveBeenCalledWith(
        'd-1',
        DeliveryFailureReason.ADMIN_ABORT,
      );
    });

    it('accepted but the delivery already moved (transition no-op) → REJECTED, appliedTransition=false', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(fetched());
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 1 });
      deliveries.beginReturnToBase.mockResolvedValue(false); // telemetry/watchdog already moved it
      const res = await service.ack('c-1', DRONE, true);
      expect(res.status).toBe(DroneCommandStatus.REJECTED);
      expect(res.appliedTransition).toBe(false);
      expect(prisma.droneCommand.update).toHaveBeenCalledWith({
        where: { id_deliveryCreatedAt: { id: 'c-1', deliveryCreatedAt: DCA } },
        data: expect.objectContaining({ status: DroneCommandStatus.REJECTED }),
      });
      // An accepted-but-superseded ack is counted distinctly from a refusal.
      expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith({
        type: DroneCommandType.RETURN_TO_BASE,
        result: 'superseded',
      });
    });

    it('accepted=false records a refusal and fires no transition', async () => {
      prisma.droneCommand.findUnique.mockResolvedValue(fetched());
      prisma.droneCommand.updateMany.mockResolvedValue({ count: 1 });
      const res = await service.ack('c-1', DRONE, false, 'unsafe to comply');
      expect(res.status).toBe(DroneCommandStatus.REJECTED);
      expect(deliveries.beginReturnToBase).not.toHaveBeenCalled();
      expect(prisma.droneCommand.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: DroneCommandStatus.FETCHED },
        data: expect.objectContaining({ status: DroneCommandStatus.REJECTED }),
      });
    });
  });

  // ── listForDelivery ──
  describe('listForDelivery', () => {
    it('404 when the delivery is missing', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);
      await expect(service.listForDelivery('d-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the command history newest-first', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ id: 'd-1' });
      prisma.droneCommand.findMany.mockResolvedValue([
        { id: 'c-2' },
        { id: 'c-1' },
      ]);
      const rows = await service.listForDelivery('d-1');
      expect(rows).toHaveLength(2);
      expect(prisma.droneCommand.findMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
