import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

import { createMockPrismaService } from '../../test/prisma-mock';
import { PHASE_TO_STATUS } from './telemetry.constants';
import { TelemetryService } from './telemetry.service';

describe('TelemetryService', () => {
  let service: TelemetryService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tracking: { updateTracking: jest.Mock };
  let publisher: { publishUpdate: jest.Mock };

  const liveDelivery = (status: DeliveryStatus, overrides = {}) => ({
    id: 'd-1',
    status,
    trackingSource: 'LIVE',
    assignedDroneId: 'drone-1',
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    tracking = { updateTracking: jest.fn().mockResolvedValue({}) };
    publisher = { publishUpdate: jest.fn().mockResolvedValue(undefined) };
    service = new TelemetryService(
      prisma as any,
      tracking as any,
      publisher as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('advances status via the monotonic forward-only CAS, tracks and publishes', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('PENDING'));

    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      phase: 'ASSIGNED',
      lat: -6.9,
      lng: 107.6,
    });

    const cas = prisma.delivery.updateMany.mock.calls[0][0];
    expect(cas.where.id).toBe('d-1');
    // Forward-only: only advance from a strictly earlier status.
    expect(cas.where.status.in).toContain('PENDING');
    expect(cas.where.status.in).not.toContain('DRONE_ASSIGNED');
    expect(cas.data).toEqual({ status: 'DRONE_ASSIGNED' });
    expect(tracking.updateTracking).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ droneLat: -6.9, droneLng: 107.6 }),
    );
    expect(publisher.publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'd-1', status: 'DRONE_ASSIGNED' }),
    );
    expect(res).toEqual({ applied: true, status: 'DRONE_ASSIGNED' });
  });

  it('is a no-op for an out-of-order / duplicate phase (CAS matches nothing)', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('IN_TRANSIT'));
    prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

    // A stale ASSIGNED phase arriving after IN_TRANSIT — and a stale position.
    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      phase: 'ASSIGNED',
      lat: -6.8,
      lng: 107.5,
    });

    // No status applied AND its companion position is dropped (frame is stale).
    expect(tracking.updateTracking).not.toHaveBeenCalled();
    expect(publisher.publishUpdate).not.toHaveBeenCalled();
    expect(res).toEqual({ applied: false });
  });

  it('never resurrects a CANCELED delivery (CAS no-op, no tracking write)', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('CANCELED'));
    prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      phase: 'IN_TRANSIT',
      lat: -6.9,
      lng: 107.6,
    });

    expect(tracking.updateTracking).not.toHaveBeenCalled();
    expect(publisher.publishUpdate).not.toHaveBeenCalled();
    expect(res.applied).toBe(false);
  });

  it('reaches AWAITING_HANDOFF on ARRIVED and writes the arrival position', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('IN_TRANSIT'));

    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      phase: 'ARRIVED',
      lat: -6.92,
      lng: 107.6,
    });

    expect(prisma.delivery.updateMany.mock.calls[0][0].data).toEqual({
      status: 'AWAITING_HANDOFF',
    });
    // A status-advancing frame carries its arrival position (mirrors handleStage).
    expect(tracking.updateTracking).toHaveBeenCalled();
    expect(res.status).toBe('AWAITING_HANDOFF');
  });

  it('never maps any drone phase to DELIVERED (no auto-deliver)', () => {
    expect(Object.values(PHASE_TO_STATUS)).not.toContain('DELIVERED');
  });

  it('rejects telemetry for a SIMULATED delivery', async () => {
    prisma.delivery.findUnique.mockResolvedValue(
      liveDelivery('PENDING', { trackingSource: 'SIMULATED' }),
    );

    await expect(
      service.ingest({ deliveryId: 'd-1', droneId: 'drone-1', phase: 'ASSIGNED' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('rejects telemetry from a drone not assigned to the delivery', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('PENDING'));

    await expect(
      service.ingest({ deliveryId: 'd-1', droneId: 'stranger', phase: 'ASSIGNED' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('is a benign no-op for an unknown delivery', async () => {
    prisma.delivery.findUnique.mockResolvedValue(null);

    const res = await service.ingest({
      deliveryId: 'missing',
      droneId: 'drone-1',
      phase: 'ASSIGNED',
    });

    expect(res).toEqual({ applied: false });
    expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
    expect(tracking.updateTracking).not.toHaveBeenCalled();
  });

  it('rejects a half-specified position (lat without lng) before any write', async () => {
    await expect(
      service.ingest({ deliveryId: 'd-1', droneId: 'drone-1', lat: -6.9 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.delivery.findUnique).not.toHaveBeenCalled();
  });

  it('applies a position-only frame and publishes coordinates without a status', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('IN_TRANSIT'));

    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      lat: -6.91,
      lng: 107.61,
    });

    expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
    expect(tracking.updateTracking).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ droneLat: -6.91, droneLng: 107.61 }),
    );
    const published = publisher.publishUpdate.mock.calls[0][0];
    expect(published.status).toBeUndefined();
    expect(published.droneLat).toBe(-6.91);
    expect(res).toEqual({ applied: true, status: undefined });
  });

  it('drops an out-of-bounds position (self-defending core) but still applies the phase', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('PENDING'));

    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      phase: 'ASSIGNED',
      lat: 999, // out of bounds
      lng: 107.6,
    });

    // Phase still advances; the garbage position is NOT written.
    expect(res.status).toBe('DRONE_ASSIGNED');
    expect(tracking.updateTracking).not.toHaveBeenCalled();
    const published = publisher.publishUpdate.mock.calls[0][0];
    expect(published.status).toBe('DRONE_ASSIGNED');
    expect(published.droneLat).toBeUndefined();
  });

  it('drops a malformed eta rather than writing a NaN date', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('PENDING'));

    await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      phase: 'ASSIGNED',
      lat: -6.9,
      lng: 107.6,
      eta: 'not-a-date',
    });

    expect(tracking.updateTracking).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ eta: undefined }),
    );
  });

  it('caps an oversized droneStatus to its max length', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('IN_TRANSIT'));

    await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      lat: -6.9,
      lng: 107.6,
      droneStatus: 'x'.repeat(500),
    });

    const written = tracking.updateTracking.mock.calls[0][1];
    expect(written.droneStatus.length).toBe(120);
  });

  it('drops a position-only frame for an AWAITING_HANDOFF delivery (no rewind)', async () => {
    prisma.delivery.findUnique.mockResolvedValue(liveDelivery('AWAITING_HANDOFF'));

    const res = await service.ingest({
      deliveryId: 'd-1',
      droneId: 'drone-1',
      lat: -6.99,
      lng: 107.99,
    });

    expect(tracking.updateTracking).not.toHaveBeenCalled();
    expect(publisher.publishUpdate).not.toHaveBeenCalled();
    expect(res.applied).toBe(false);
  });
});
