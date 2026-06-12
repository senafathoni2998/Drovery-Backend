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
  let proof: { createAutoProof: jest.Mock };

  const coords = { fromLat: -6.9, fromLng: 107.6, toLat: -6.92, toLng: 107.62 };

  beforeEach(() => {
    prisma = createMockPrismaService();
    // Default: the atomic transition applies (1 row updated).
    prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    tracking = { updateTracking: jest.fn().mockResolvedValue({}) };
    publisher = { publishUpdate: jest.fn().mockResolvedValue(undefined) };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    proof = { createAutoProof: jest.fn().mockResolvedValue({}) };

    processor = new SimulationProcessor(
      prisma as any,
      tracking as any,
      publisher as any,
      notifications as any,
      proof as any,
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

  it('records proof of delivery on the DELIVERED stage', async () => {
    prisma.delivery.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'IN_TRANSIT',
      receiver: 'Budi',
    });
    const deliveredIndex = STAGES.findIndex(
      (s) => s.status === DeliveryStatus.DELIVERED,
    );

    await processor.process(stageJob(deliveredIndex));

    expect(proof.createAutoProof).toHaveBeenCalledWith('d-1', {
      lat: coords.toLat,
      lng: coords.toLng,
      recipientName: 'Budi',
    });
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

  it('skips position updates once delivered/canceled', async () => {
    prisma.delivery.findUnique.mockResolvedValue({ status: 'DELIVERED' });

    await processor.process({
      name: 'position',
      data: { deliveryId: 'd-1', lat: 1, lng: 2 },
    } as any);

    expect(tracking.updateTracking).not.toHaveBeenCalled();
  });
});
