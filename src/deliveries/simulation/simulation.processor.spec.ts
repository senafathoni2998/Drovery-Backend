import { DeliveryStatus } from '@prisma/client';

import { SimulationProcessor } from './simulation.processor';
import { STAGES } from './simulation.constants';
import { createMockPrismaService } from '../../test/prisma-mock';

describe('SimulationProcessor', () => {
  let processor: SimulationProcessor;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tracking: { updateTracking: jest.Mock };
  let publisher: { publishUpdate: jest.Mock };
  let notifications: { create: jest.Mock };
  let simulationService: { startSimulation: jest.Mock };

  const coords = { fromLat: -6.9, fromLng: 107.6, toLat: -6.92, toLng: 107.62 };

  beforeEach(() => {
    prisma = createMockPrismaService();
    // Default: the atomic transition applies (1 row updated).
    prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    tracking = { updateTracking: jest.fn().mockResolvedValue({}) };
    publisher = { publishUpdate: jest.fn().mockResolvedValue(undefined) };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    simulationService = { startSimulation: jest.fn().mockResolvedValue(undefined) };

    processor = new SimulationProcessor(
      prisma as any,
      tracking as any,
      publisher as any,
      notifications as any,
      simulationService as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  const stageJob = (stageIndex: number) =>
    ({
      name: 'stage',
      data: { deliveryId: 'd-1', userId: 'u-1', coords, stageIndex },
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

  it('skips side effects when the CAS matches nothing (canceled / already advanced)', async () => {
    prisma.delivery.findUnique.mockResolvedValue({ id: 'd-1', status: 'CANCELED' });
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
    expect(STAGES.some((s) => s.status === DeliveryStatus.DELIVERED)).toBe(false);

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
      data: { deliveryId: 'd-1', lat: 1, lng: 2 },
    } as any);

    expect(tracking.updateTracking).toHaveBeenCalledWith('d-1', {
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
  });

  describe('kickoff', () => {
    const kickoffJob = () =>
      ({ name: 'kickoff', data: { deliveryId: 'd-1', userId: 'u-1', coords } }) as any;

    it('starts the simulation then flips SCHEDULED → PENDING via the CAS', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ status: DeliveryStatus.SCHEDULED });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await processor.process(kickoffJob());

      // Enqueue happens BEFORE the status flip (so a retry can recover).
      expect(simulationService.startSimulation).toHaveBeenCalledWith('d-1', 'u-1', coords);
      const call = prisma.delivery.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'd-1', status: DeliveryStatus.SCHEDULED });
      expect(call.data).toEqual({ status: DeliveryStatus.PENDING });
    });

    it('is a no-op when the delivery is no longer SCHEDULED (canceled / already kicked off)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ status: DeliveryStatus.CANCELED });

      await processor.process(kickoffJob());

      expect(simulationService.startSimulation).not.toHaveBeenCalled();
      expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
    });
  });
});
