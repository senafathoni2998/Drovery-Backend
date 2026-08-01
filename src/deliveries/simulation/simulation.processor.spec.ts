import { DeliveryStatus } from '@prisma/client';

import { SimulationProcessor } from './simulation.processor';
import { STAGES } from './simulation.constants';
import { PREFLIGHT_MAX_ATTEMPTS } from './preflight.constants';
import { I18nService } from '../../i18n/i18n.service';
import { createMockPrismaService } from '../../test/prisma-mock';

describe('SimulationProcessor', () => {
  let processor: SimulationProcessor;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tracking: { updateTracking: jest.Mock };
  let publisher: { publishUpdate: jest.Mock };
  let notifications: { create: jest.Mock };
  let simulationService: {
    startSimulation: jest.Mock;
    deferKickoff: jest.Mock;
  };
  let serviceability: { checkServiceability: jest.Mock };
  let dispatchService: { dispatch: jest.Mock; release: jest.Mock };
  let deliveries: { failExceptional: jest.Mock };
  let metrics: {
    preflightHoldsTotal: { inc: jest.Mock };
    preflightAbortsTotal: { inc: jest.Mock };
  };

  /** Conditions are good — the default for every test that isn't about pre-flight. */
  const flyable = {
    serviceable: true,
    reasons: [],
    codes: [] as string[],
    weatherHold: false,
  };

  const coords = { fromLat: -6.9, fromLng: 107.6, toLat: -6.92, toLng: 107.62 };
  // Parent createdAt stamped on every job (deliveries is partitioned).
  const DCA = '2026-06-01T00:00:00.000Z';

  beforeEach(() => {
    prisma = createMockPrismaService();
    // Default: the atomic transition applies (1 row updated).
    prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    tracking = { updateTracking: jest.fn().mockResolvedValue({}) };
    publisher = { publishUpdate: jest.fn().mockResolvedValue(undefined) };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    simulationService = {
      startSimulation: jest.fn().mockResolvedValue(undefined),
      deferKickoff: jest.fn().mockResolvedValue(undefined),
    };
    serviceability = {
      checkServiceability: jest.fn().mockResolvedValue(flyable),
    };
    dispatchService = {
      // Live dispatch off by default, exactly as every deployment runs today.
      dispatch: jest
        .fn()
        .mockResolvedValue({ trackingSource: 'SIMULATED', droneId: null }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    deliveries = { failExceptional: jest.fn().mockResolvedValue(true) };
    metrics = {
      preflightHoldsTotal: { inc: jest.fn() },
      preflightAbortsTotal: { inc: jest.fn() },
    };

    processor = new SimulationProcessor(
      prisma as any,
      tracking as any,
      publisher as any,
      notifications as any,
      simulationService as any,
      serviceability as any,
      dispatchService as any,
      deliveries as any,
      metrics as any,
      new I18nService(), // pure; real translations keep assertions meaningful
    );
  });

  afterEach(() => jest.clearAllMocks());

  const stageJob = (stageIndex: number) =>
    ({
      name: 'stage',
      data: {
        deliveryId: 'd-1',
        deliveryCreatedAt: DCA,
        userId: 'u-1',
        coords,
        stageIndex,
      },
    }) as any;

  it('advances status (atomic monotonic CAS), tracks, notifies and broadcasts', async () => {
    prisma.delivery.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'PENDING',
      receiver: 'Budi',
    });

    await processor.process(stageJob(0));

    // Forward-only compare-and-set: only advance from a strictly earlier status.
    const call = prisma.delivery.updateMany.mock.calls[0][0];
    expect(call.where.id).toBe('d-1');
    expect(call.where.status.in).toContain('PENDING');
    expect(call.where.status.in).not.toContain(STAGES[0].status);
    expect(call.data).toEqual({ status: STAGES[0].status });
    expect(tracking.updateTracking).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalled();
    expect(publisher.publishUpdate).toHaveBeenCalled();
  });

  it('localizes the stage notification + map label to the owner locale (worker, no request)', async () => {
    prisma.delivery.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'PENDING',
    });
    // Worker resolves User.locale by userId (the only locale signal it has).
    prisma.user.findUnique.mockResolvedValue({ locale: 'id' });

    await processor.process(stageJob(0)); // CONFIRMED

    // Indonesian title/body reached the notification, and the map label too.
    expect(notifications.create).toHaveBeenCalledWith(
      'u-1',
      'Pengiriman Dikonfirmasi',
      'Pengiriman Anda telah dikonfirmasi dan sedang diproses.',
      expect.objectContaining({ status: 'CONFIRMED' }),
    );
    expect(publisher.publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ droneStatus: 'Pengiriman dikonfirmasi' }),
    );
  });

  it('skips side effects when the CAS matches nothing (canceled / already advanced)', async () => {
    prisma.delivery.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'CANCELED',
    });
    prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

    await processor.process(stageJob(1));

    expect(notifications.create).not.toHaveBeenCalled();
    expect(publisher.publishUpdate).not.toHaveBeenCalled();
  });

  it('does nothing for a deleted delivery (no CAS attempted)', async () => {
    prisma.delivery.findUnique.mockResolvedValue(null);

    await processor.process(stageJob(1));

    expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('stops at AWAITING_HANDOFF as the terminal auto stage (never auto-delivers)', async () => {
    prisma.delivery.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'IN_TRANSIT',
      receiver: 'Budi',
    });
    // The last auto stage is AWAITING_HANDOFF; DELIVERED is no longer simulated.
    const lastIndex = STAGES.length - 1;
    expect(STAGES[lastIndex].status).toBe(DeliveryStatus.AWAITING_HANDOFF);
    expect(STAGES.some((s) => s.status === DeliveryStatus.DELIVERED)).toBe(
      false,
    );

    await processor.process(stageJob(lastIndex));

    // It transitions to AWAITING_HANDOFF via the CAS and publishes the update —
    // proof + DELIVERED happen only on the confirm-handoff endpoint.
    expect(prisma.delivery.updateMany.mock.calls[0][0].data).toEqual({
      status: DeliveryStatus.AWAITING_HANDOFF,
    });
    expect(publisher.publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: DeliveryStatus.AWAITING_HANDOFF }),
    );
  });

  it('updates drone position on a position job for an active delivery', async () => {
    prisma.delivery.findUnique.mockResolvedValue({ status: 'IN_TRANSIT' });

    await processor.process({
      name: 'position',
      data: { deliveryId: 'd-1', deliveryCreatedAt: DCA, lat: 1, lng: 2 },
    } as any);

    expect(tracking.updateTracking).toHaveBeenCalledWith('d-1', new Date(DCA), {
      droneLat: 1,
      droneLng: 2,
    });
  });

  it.each(['DELIVERED', 'CANCELED', 'AWAITING_HANDOFF'])(
    'skips position updates once %s',
    async (status) => {
      prisma.delivery.findUnique.mockResolvedValue({ status });

      await processor.process({
        name: 'position',
        data: { deliveryId: 'd-1', lat: 1, lng: 2 },
      } as any);

      expect(tracking.updateTracking).not.toHaveBeenCalled();
    },
  );

  describe('kickoff', () => {
    const kickoffJob = () =>
      ({
        name: 'kickoff',
        data: {
          deliveryId: 'd-1',
          deliveryCreatedAt: DCA,
          userId: 'u-1',
          coords,
        },
      }) as any;

    it('starts the simulation then flips SCHEDULED → PENDING via the CAS', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        status: DeliveryStatus.SCHEDULED,
      });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await processor.process(kickoffJob());

      // Enqueue happens BEFORE the status flip (so a retry can recover).
      expect(simulationService.startSimulation).toHaveBeenCalledWith(
        'd-1',
        new Date(DCA),
        'u-1',
        coords,
      );
      const call = prisma.delivery.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: 'd-1',
        status: DeliveryStatus.SCHEDULED,
      });
      expect(call.data).toEqual({ status: DeliveryStatus.PENDING });
    });

    it('is a no-op when the delivery is no longer SCHEDULED (canceled / already kicked off)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        status: DeliveryStatus.CANCELED,
      });

      await processor.process(kickoffJob());

      expect(simulationService.startSimulation).not.toHaveBeenCalled();
      expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
    });
  });

  // Serviceability was evaluated in the quote and in create() and NEVER AGAIN, so a
  // delivery booked 60 days out was weather-checked at booking and then launched by
  // this job into whatever was actually happening two months later.
  describe('kickoff — the pre-flight check', () => {
    const scheduled = {
      status: DeliveryStatus.SCHEDULED,
      createdAt: new Date(DCA),
      fromLat: -6.9,
      fromLng: 107.6,
      toLat: -6.92,
      toLng: 107.62,
      packageWeight: 1,
    };

    const kickoffJob = (over: Record<string, unknown> = {}) =>
      ({
        name: 'kickoff',
        data: {
          deliveryId: 'd-1',
          deliveryCreatedAt: DCA,
          userId: 'u-1',
          coords,
          ...over,
        },
      }) as any;

    const blocked = (codes: string[], weatherHold: boolean) => ({
      serviceable: false,
      reasons: [],
      codes,
      weatherHold,
    });

    beforeEach(() => {
      prisma.delivery.findUnique.mockResolvedValue(scheduled);
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    });

    it('re-checks conditions against the STORED route immediately before launch', async () => {
      await processor.process(kickoffJob());

      expect(serviceability.checkServiceability).toHaveBeenCalledWith(
        -6.9,
        107.6,
        -6.92,
        107.62,
      );
    });

    it('holds a weather-grounded launch instead of flying into it', async () => {
      serviceability.checkServiceability.mockResolvedValue(
        blocked(['WEATHER_STORM'], true),
      );

      await processor.process(kickoffJob());

      expect(simulationService.deferKickoff).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: 'd-1' }),
        1,
      );
      // Nothing launched, nothing transitioned, nothing failed.
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
      expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
      expect(deliveries.failExceptional).not.toHaveBeenCalled();
    });

    it('carries the attempt count forward across holds', async () => {
      serviceability.checkServiceability.mockResolvedValue(
        blocked(['WEATHER_HOLD'], true),
      );

      await processor.process(kickoffJob({ preflightAttempt: 2 }));

      expect(simulationService.deferKickoff).toHaveBeenCalledWith(
        expect.anything(),
        3,
      );
    });

    it('gives up rather than holding forever, and refunds', async () => {
      // A delivery held indefinitely sits in SCHEDULED looking to its customer
      // exactly like one that is about to happen.
      serviceability.checkServiceability.mockResolvedValue(
        blocked(['WEATHER_STORM'], true),
      );

      await processor.process(
        kickoffJob({ preflightAttempt: PREFLIGHT_MAX_ATTEMPTS - 1 }),
      );

      expect(simulationService.deferKickoff).not.toHaveBeenCalled();
      expect(deliveries.failExceptional).toHaveBeenCalledWith(
        'd-1',
        'WEATHER_ABORT',
        [DeliveryStatus.SCHEDULED],
      );
    });

    it('fails a HARD block immediately — waiting will not move a no-fly zone', async () => {
      serviceability.checkServiceability.mockResolvedValue(
        blocked(['NO_FLY_ZONE'], false),
      );

      await processor.process(kickoffJob());

      expect(simulationService.deferKickoff).not.toHaveBeenCalled();
      expect(deliveries.failExceptional).toHaveBeenCalledWith(
        'd-1',
        'UNSAFE_DROP_ZONE',
        [DeliveryStatus.SCHEDULED],
      );
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
    });

    it('scopes the failure to SCHEDULED — it must not reach in-flight statuses', async () => {
      // FAILABLE_STATUSES is wider and covers the in-flight states; passing it here
      // would let a pre-flight abort fail a delivery that had already launched.
      serviceability.checkServiceability.mockResolvedValue(
        blocked(['OUT_OF_AREA'], false),
      );

      await processor.process(kickoffJob());

      expect(deliveries.failExceptional.mock.calls[0][2]).toEqual([
        DeliveryStatus.SCHEDULED,
      ]);
    });

    it('launches an unroutable delivery rather than double-failing it', async () => {
      // No coordinates means nothing to check geometrically — and dispatch rejects
      // it on its own, so failing here would just be the second refusal.
      prisma.delivery.findUnique.mockResolvedValue({
        ...scheduled,
        fromLat: null,
        fromLng: null,
      });

      await processor.process(kickoffJob());

      expect(serviceability.checkServiceability).not.toHaveBeenCalled();
      expect(prisma.delivery.updateMany).toHaveBeenCalled();
    });
  });

  // create() deliberately claims no aircraft for a scheduled delivery — you do not
  // hold an airframe out of service for weeks. This is where that is paid off.
  describe('kickoff — dispatch at launch', () => {
    const scheduled = {
      status: DeliveryStatus.SCHEDULED,
      createdAt: new Date(DCA),
      fromLat: -6.9,
      fromLng: 107.6,
      toLat: -6.92,
      toLng: 107.62,
      packageWeight: 2.5,
    };

    const kickoffJob = () =>
      ({
        name: 'kickoff',
        data: {
          deliveryId: 'd-1',
          deliveryCreatedAt: DCA,
          userId: 'u-1',
          coords,
        },
      }) as any;

    beforeEach(() => {
      prisma.delivery.findUnique.mockResolvedValue(scheduled);
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    });

    it('asks for an aircraft as an IMMEDIATE delivery — its window is now', async () => {
      await processor.process(kickoffJob());

      expect(dispatchService.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'd-1',
          payloadKg: 2.5,
          isScheduled: false,
        }),
      );
    });

    it('binds the airframe in the SAME write as the transition', async () => {
      dispatchService.dispatch.mockResolvedValue({
        trackingSource: 'LIVE',
        droneId: 'drone-7',
      });

      await processor.process(kickoffJob());

      // Otherwise the row is briefly PENDING + SIMULATED with a live drone bound.
      expect(prisma.delivery.updateMany.mock.calls[0][0].data).toEqual({
        status: DeliveryStatus.PENDING,
        trackingSource: 'LIVE',
        assignedDroneId: 'drone-7',
      });
    });

    it('enqueues NO simulation for a live launch', async () => {
      dispatchService.dispatch.mockResolvedValue({
        trackingSource: 'LIVE',
        droneId: 'drone-7',
      });

      await processor.process(kickoffJob());

      // The guarantee that a sim and a live producer can never both drive one row.
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
    });

    it('still simulates when live dispatch is off', async () => {
      await processor.process(kickoffJob());

      expect(simulationService.startSimulation).toHaveBeenCalled();
      expect(prisma.delivery.updateMany.mock.calls[0][0].data).toEqual({
        status: DeliveryStatus.PENDING,
      });
    });

    it('gives the aircraft back when the transition loses the race', async () => {
      // Canceled during pre-flight, or another replica got there first. The claim
      // committed on a separate non-partitioned row, so nothing rolls it back and
      // every later release is keyed on a delivery that is no longer ours.
      dispatchService.dispatch.mockResolvedValue({
        trackingSource: 'LIVE',
        droneId: 'drone-7',
      });
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

      await processor.process(kickoffJob());

      expect(dispatchService.release).toHaveBeenCalledWith(
        'd-1',
        'RETURN_TO_FLEET',
      );
    });

    it('releases nothing when there was nothing to release', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

      await processor.process(kickoffJob());

      expect(dispatchService.release).not.toHaveBeenCalled();
    });

    it('does not dispatch a delivery the pre-flight refused', async () => {
      serviceability.checkServiceability.mockResolvedValue({
        serviceable: false,
        reasons: [],
        codes: ['NO_FLY_ZONE'],
        weatherHold: false,
      });

      await processor.process(kickoffJob());

      expect(dispatchService.dispatch).not.toHaveBeenCalled();
    });
  });

  // A job enqueued BEFORE the delivery-graph partitioning deploy has no deliveryCreatedAt
  // in its payload. `new Date(undefined)` is an Invalid Date — left unguarded it threw a
  // RangeError in startSimulation (stranding the delivery in SCHEDULED forever) and an FK
  // violation in updateTracking. The handler must fall back to the delivery row's real
  // createdAt (which it already reads) so the lifecycle still progresses.
  describe('stale pre-deploy job (no deliveryCreatedAt in payload)', () => {
    const fallback = new Date('2026-05-15T12:00:00.000Z');

    it('kickoff falls back to the delivery createdAt instead of stranding (no RangeError)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        status: DeliveryStatus.SCHEDULED,
        createdAt: fallback,
      });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await processor.process({
        name: 'kickoff',
        data: { deliveryId: 'd-1', userId: 'u-1', coords }, // no deliveryCreatedAt
      } as any);

      expect(simulationService.startSimulation).toHaveBeenCalledWith(
        'd-1',
        fallback,
        'u-1',
        coords,
      );
      // The SCHEDULED → PENDING flip still happens — the delivery is not stranded.
      expect(prisma.delivery.updateMany.mock.calls[0][0].data).toEqual({
        status: DeliveryStatus.PENDING,
      });
    });

    it('position falls back to the delivery createdAt (writes the tracking snapshot)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        status: 'IN_TRANSIT',
        createdAt: fallback,
      });

      await processor.process({
        name: 'position',
        data: { deliveryId: 'd-1', lat: 1, lng: 2 }, // no deliveryCreatedAt
      } as any);

      expect(tracking.updateTracking).toHaveBeenCalledWith('d-1', fallback, {
        droneLat: 1,
        droneLng: 2,
      });
    });
  });
});
