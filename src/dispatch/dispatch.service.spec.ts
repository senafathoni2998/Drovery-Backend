import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { DispatchService } from './dispatch.service';
import { MIN_DISPATCH_BATTERY_PERCENT } from './dispatch.constants';

const BASE = { lat: -6.9125, lng: 107.611 };

const ROUTE = {
  fromLat: BASE.lat,
  fromLng: BASE.lng + 1 / 111,
  toLat: BASE.lat,
  toLng: BASE.lng + 2 / 111,
};

const aircraft = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  maxPayloadKg: 5,
  rangeKm: 30,
  batteryPercent: 100,
  homeBaseLat: BASE.lat,
  homeBaseLng: BASE.lng,
  currentLat: null,
  currentLng: null,
  ...over,
});

describe('DispatchService', () => {
  let service: DispatchService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(DispatchService);
  });

  afterEach(() => {
    delete process.env.LIVE_DISPATCH;
    jest.clearAllMocks();
  });

  const req = (over: Record<string, unknown> = {}) => ({
    deliveryId: 'del-1',
    payloadKg: 1,
    route: ROUTE,
    isScheduled: false,
    ...over,
  });

  describe('when live dispatch is off (the default)', () => {
    it('returns SIMULATED and never reads the fleet', async () => {
      // This is what every existing deployment, CI run and demo does. It must not
      // require a registered fleet to exist at all.
      await expect(service.dispatch(req())).resolves.toEqual({
        trackingSource: 'SIMULATED',
        droneId: null,
      });
      expect(prisma.drone.findMany).not.toHaveBeenCalled();
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('stays SIMULATED even for a value that merely looks truthy', async () => {
      process.env.LIVE_DISPATCH = '1';
      await expect(service.dispatch(req())).resolves.toMatchObject({
        trackingSource: 'SIMULATED',
      });
    });
  });

  describe('when live dispatch is on', () => {
    beforeEach(() => {
      process.env.LIVE_DISPATCH = 'true';
    });

    it('claims nothing for a scheduled pickup', async () => {
      // You do not hold an airframe out of service for three weeks.
      await expect(
        service.dispatch(req({ isScheduled: true })),
      ).resolves.toEqual({ trackingSource: 'SIMULATED', droneId: null });
      expect(prisma.drone.findMany).not.toHaveBeenCalled();
    });

    it('selects, claims and reports LIVE', async () => {
      prisma.drone.findMany.mockResolvedValue([aircraft()]);
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.dispatch(req())).resolves.toEqual({
        trackingSource: 'LIVE',
        droneId: 'd1',
      });
    });

    it('puts every precondition in the claim WHERE, not in a prior read', () => {
      // A read-then-write lets two concurrent bookings both "win". The conditional
      // update is what makes the loser match zero rows.
      prisma.drone.findMany.mockResolvedValue([aircraft()]);
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });

      return service.dispatch(req({ payloadKg: 2 })).then(() => {
        const { where, data } = prisma.drone.updateMany.mock.calls[0][0];
        expect(where).toEqual({
          id: 'd1',
          airworthy: true,
          status: 'AVAILABLE',
          activeDeliveryId: null,
          maxPayloadKg: { gte: 2 },
        });
        expect(data).toEqual({
          activeDeliveryId: 'del-1',
          status: 'IN_FLIGHT',
        });
      });
    });

    it('excludes the ungrounded-but-overdue from the candidate read', async () => {
      prisma.drone.findMany.mockResolvedValue([aircraft()]);
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });

      await service.dispatch(req());

      const { where } = prisma.drone.findMany.mock.calls[0][0];
      expect(where).toMatchObject({
        airworthy: true,
        status: 'AVAILABLE',
        activeDeliveryId: null,
        batteryPercent: { gte: MIN_DISPATCH_BATTERY_PERCENT },
      });
      // A lapsed inspection grounds an aircraft whether or not anyone got round to
      // flipping `airworthy`.
      expect(where.OR).toEqual([
        { maintenanceDueAt: null },
        { maintenanceDueAt: { gt: expect.any(Date) } },
      ]);
    });

    it('walks down the ranking when a race is lost', async () => {
      prisma.drone.findMany.mockResolvedValue([
        aircraft({ id: 'first', maxPayloadKg: 2 }),
        aircraft({ id: 'second', maxPayloadKg: 3 }),
      ]);
      prisma.drone.updateMany
        .mockResolvedValueOnce({ count: 0 }) // taken between read and write
        .mockResolvedValue({ count: 1 });

      await expect(service.dispatch(req())).resolves.toMatchObject({
        droneId: 'second',
      });
      expect(prisma.drone.updateMany).toHaveBeenCalledTimes(2);
    });

    it('rejects with the vague message when the fleet is merely busy', async () => {
      // Which airframes are airworthy, charged or already flying is fleet
      // information, and this path is reachable by any authenticated customer.
      prisma.drone.findMany.mockResolvedValue([]);
      prisma.drone.count.mockResolvedValue(4);

      await expect(service.dispatch(req())).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          messageKey: 'error.delivery.dispatch.unavailable',
        }),
      });
    });

    it('says so plainly when no airframe could EVER lift it', async () => {
      // "Try again later" is a lie when the answer will never change.
      prisma.drone.findMany.mockResolvedValue([]);
      prisma.drone.count.mockResolvedValue(0);

      await expect(
        service.dispatch(req({ payloadKg: 40 })),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          messageKey: 'error.delivery.dispatch.no_capacity',
        }),
      });
    });

    it('prefers the vaguer message when the capability count itself fails', async () => {
      prisma.drone.findMany.mockResolvedValue([]);
      prisma.drone.count.mockRejectedValue(new Error('db down'));

      await expect(service.dispatch(req())).rejects.toMatchObject({
        response: expect.objectContaining({
          messageKey: 'error.delivery.dispatch.unavailable',
        }),
      });
    });

    it('does not claim an aircraft that cannot get home', async () => {
      // Feasibility is applied AFTER the SQL filter — the DB can express payload
      // and charge, but not "far enough to get there and back".
      prisma.drone.findMany.mockResolvedValue([aircraft({ rangeKm: 0.5 })]);
      prisma.drone.count.mockResolvedValue(1);

      await expect(service.dispatch(req())).rejects.toMatchObject({
        status: 409,
      });
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to dispatch to an address it could not geocode', async () => {
      // Feasibility is entirely geometric; an ungeocoded address is not degraded
      // input, there is nothing to compute.
      prisma.drone.findMany.mockResolvedValue([aircraft()]);

      await expect(
        service.dispatch(req({ route: { fromLat: 1, fromLng: 1 } })),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.drone.findMany).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('is scoped to THIS delivery, so a late release cannot free someone else’s drone', async () => {
      await service.release('del-1', 'RETURN_TO_FLEET');

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'del-1' },
        data: { activeDeliveryId: null, status: 'AVAILABLE' },
      });
    });

    it('clears airworthy — not just the status — when grounding for inspection', async () => {
      // Only parking it in MAINTENANCE would leave it dispatchable the moment an
      // operator flipped it back to AVAILABLE without anyone having looked at it.
      await service.release('del-1', 'GROUND_FOR_INSPECTION');

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'del-1' },
        data: {
          activeDeliveryId: null,
          status: 'MAINTENANCE',
          airworthy: false,
        },
      });
    });

    it('swallows a failure — it runs inside terminal cleanup that has already committed', async () => {
      prisma.drone.updateMany.mockRejectedValue(new Error('db down'));

      // A leaked claim is recoverable by an operator; a delivery stuck
      // half-terminated is not.
      await expect(
        service.release('del-1', 'RETURN_TO_FLEET'),
      ).resolves.toBeUndefined();
    });
  });
});
