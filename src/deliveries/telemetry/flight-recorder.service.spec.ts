import { DeliveryStatus } from '@prisma/client';

import { createMockPrismaService } from '../../test/prisma-mock';
import {
  FlightRecorderService,
  RecorderContext,
} from './flight-recorder.service';
import { CRITICAL_BATTERY_PERCENT } from './flight-recorder.constants';
import { TelemetryMessage } from './telemetry.constants';

const BASE = { lat: -6.9125, lng: 107.611 };

const ctx = (over: Partial<RecorderContext> = {}): RecorderContext => ({
  deliveryId: 'd-1',
  deliveryCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
  droneId: 'drone-1',
  status: DeliveryStatus.IN_TRANSIT,
  packageWeight: 1,
  ...over,
});

const frame = (over: Partial<TelemetryMessage> = {}): TelemetryMessage => ({
  deliveryId: 'd-1',
  droneId: 'drone-1',
  lat: BASE.lat,
  lng: BASE.lng,
  ...over,
});

const fleetRow = (over: Record<string, unknown> = {}) => ({
  id: 'drone-1',
  serial: 'DRV-001',
  rangeKm: 20,
  maxPayloadKg: 5,
  homeBaseLat: BASE.lat,
  homeBaseLng: BASE.lng,
  ...over,
});

describe('FlightRecorderService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let commands: { issue: jest.Mock };
  let metrics: { autoReturnsTotal: { inc: jest.Mock } };
  let service: FlightRecorderService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.flightFrame.create.mockResolvedValue({});
    prisma.drone.findUnique.mockResolvedValue(fleetRow());
    commands = { issue: jest.fn().mockResolvedValue({}) };
    metrics = { autoReturnsTotal: { inc: jest.fn() } };
    service = new FlightRecorderService(
      prisma as any,
      commands as any,
      metrics as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('the flight log', () => {
    it('appends the frame with every field the aircraft reported', async () => {
      await service.record(
        ctx(),
        frame({
          altitudeM: 85,
          batteryPercent: 77,
          airspeedKph: 42,
          phase: 'IN_TRANSIT',
          droneStatus: 'cruising',
        }),
      );

      expect(prisma.flightFrame.create.mock.calls[0][0].data).toMatchObject({
        deliveryId: 'd-1',
        droneId: 'drone-1',
        altitudeM: 85,
        batteryPercent: 77,
        airspeedKph: 42,
        phase: 'IN_TRANSIT',
        droneStatus: 'cruising',
      });
    });

    it('carries the partition key, or the insert has nowhere to land', async () => {
      await service.record(ctx(), frame());
      expect(
        prisma.flightFrame.create.mock.calls[0][0].data.deliveryCreatedAt,
      ).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    });

    it('records a frame from a TERMINAL delivery too', async () => {
      // The log records what was RECEIVED, not what was accepted. A frame arriving
      // after the delivery ended is exactly what a wedged flight controller looks
      // like from the ground, and dropping it destroys the evidence.
      await service.record(
        ctx({ status: DeliveryStatus.DELIVERY_FAILED }),
        frame({ batteryPercent: 4 }),
      );
      expect(prisma.flightFrame.create).toHaveBeenCalled();
    });

    it('never fails the ingest when the append fails', async () => {
      // A recorder problem must not stop a drone reporting its position — that
      // stream is what tells the watchdog a flying aircraft from a crashed one.
      prisma.flightFrame.create.mockRejectedValue(
        new Error('partition missing'),
      );

      await expect(service.record(ctx(), frame())).resolves.toBeUndefined();
    });
  });

  describe('the aircraft row', () => {
    it('freshens position and charge so dispatch stops using registration values', async () => {
      await service.record(
        ctx(),
        frame({ lat: -6.8, lng: 107.5, batteryPercent: 64 }),
      );

      const call = prisma.drone.updateMany.mock.calls[0][0];
      expect(call.data).toMatchObject({
        currentLat: -6.8,
        currentLng: 107.5,
        batteryPercent: 64,
      });
      expect(call.data.lastSeenAt).toBeInstanceOf(Date);
    });

    it('is scoped to the ACTIVE claim, not the drone id', async () => {
      // Otherwise a late frame from a finished flight overwrites the position of an
      // aircraft that has since been claimed by a different delivery.
      await service.record(ctx(), frame({ batteryPercent: 50 }));
      expect(prisma.drone.updateMany.mock.calls[0][0].where).toEqual({
        activeDeliveryId: 'd-1',
      });
    });

    it('does not write a battery it was not told', async () => {
      await service.record(ctx(), frame({ lat: -6.8, lng: 107.5 }));
      expect(prisma.drone.updateMany.mock.calls[0][0].data).not.toHaveProperty(
        'batteryPercent',
      );
    });

    it('skips the write entirely for a frame carrying neither', async () => {
      await service.record(ctx(), frame({ lat: undefined, lng: undefined }));
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('auto-return', () => {
    const flat = () => frame({ batteryPercent: CRITICAL_BATTERY_PERCENT - 1 });

    beforeEach(() => {
      prisma.drone.findUnique.mockResolvedValue(fleetRow());
    });

    it('recalls the aircraft itself, with no operator involved', async () => {
      // The RETURN_TO_BASE mechanism was fully built and tested; nothing ever
      // computed WHEN to fire it except a human watching a screen.
      await service.record(ctx(), flat());

      expect(commands.issue).toHaveBeenCalledWith(null, 'd-1', {
        type: 'RETURN_TO_BASE',
      });
      expect(metrics.autoReturnsTotal.inc).toHaveBeenCalledWith({
        reason: 'CRITICAL_BATTERY',
      });
    });

    it('attributes the command to the platform, not to an admin', async () => {
      await service.record(ctx(), flat());
      expect(commands.issue.mock.calls[0][0]).toBeNull();
    });

    it('leaves a healthy aircraft flying', async () => {
      await service.record(ctx(), frame({ batteryPercent: 95 }));
      expect(commands.issue).not.toHaveBeenCalled();
    });

    it('will not invent a state of charge it was never sent', async () => {
      await service.record(ctx(), frame({ batteryPercent: undefined }));
      expect(commands.issue).not.toHaveBeenCalled();
    });

    it('needs a position as well — a recall decided blind is a guess', async () => {
      await service.record(
        ctx(),
        frame({ lat: undefined, lng: undefined, batteryPercent: 2 }),
      );
      expect(commands.issue).not.toHaveBeenCalled();
    });

    it('does not fire before pickup — there is nothing to fly home', async () => {
      await service.record(ctx({ status: DeliveryStatus.CONFIRMED }), flat());
      expect(commands.issue).not.toHaveBeenCalled();
    });

    it('does not fire on a frame that is already reporting an abort', async () => {
      // The drone is ending the flight itself; a command here would just collide
      // with the transition the same frame is driving.
      await service.record(
        ctx(),
        frame({ batteryPercent: 2, phase: 'RETURNING' }),
      );
      expect(commands.issue).not.toHaveBeenCalled();
    });

    it('does not re-issue on every frame of a 10 Hz stream', async () => {
      await service.record(ctx(), flat());
      await service.record(ctx(), flat());
      await service.record(ctx(), flat());

      expect(commands.issue).toHaveBeenCalledTimes(1);
    });

    it('swallows the 409 that means a recall is already in flight', async () => {
      // The open-command partial unique index doing its job is the NORMAL outcome,
      // and it must not fail an ingest.
      commands.issue.mockRejectedValue(
        Object.assign(new Error('conflict'), { status: 409 }),
      );

      await expect(service.record(ctx(), flat())).resolves.toBeUndefined();
    });

    it('does nothing when the delivery holds no aircraft', async () => {
      prisma.drone.findUnique.mockResolvedValue(null);

      await service.record(ctx(), flat());

      expect(commands.issue).not.toHaveBeenCalled();
    });

    it('forgets a delivery so the cooldown map cannot grow without bound', async () => {
      await service.record(ctx(), flat());
      expect(commands.issue).toHaveBeenCalledTimes(1);

      service.forget('d-1');
      await service.record(ctx(), flat());

      expect(commands.issue).toHaveBeenCalledTimes(2);
    });
  });
});
