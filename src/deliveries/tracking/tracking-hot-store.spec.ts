import { ConfigService } from '@nestjs/config';

import { TrackingHotStore } from './tracking-hot-store';
import {
  CHECKPOINT_INTERVAL_MS,
  CHECKPOINT_SAFETY_FACTOR,
  assertCheckpointSafe,
} from './tracking-hot-store.constants';
import { WATCHDOG_SILENCE_MS } from '../../delivery-watchdog/watchdog.constants';
import { createMockPrismaService } from '../../test/prisma-mock';

// A chainable MULTI stub: hset/expire/sadd return the pipeline; exec resolves.
function makeMulti() {
  const m: Record<string, jest.Mock> = {};
  m.hset = jest.fn(() => m);
  m.expire = jest.fn(() => m);
  m.sadd = jest.fn(() => m);
  m.exec = jest.fn().mockResolvedValue([]);
  return m;
}

describe('TrackingHotStore', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let store: TrackingHotStore;
  let client: Record<string, jest.Mock>;
  let lastMulti: ReturnType<typeof makeMulti>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    client = {
      multi: jest.fn(() => (lastMulti = makeMulti())),
      hgetall: jest.fn(),
      spop: jest.fn(),
      sadd: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
    };
    store = new TrackingHotStore(
      { get: jest.fn() } as unknown as ConfigService,
      prisma as never,
    );
    // Bypass onModuleInit (which only connects when enabled) — drive the client directly.
    (store as unknown as { client: unknown }).client = client;
  });

  it('is disabled by default (no TRACKING_HOT_STORE env)', () => {
    expect(store.enabled).toBe(false);
  });

  describe('writePosition', () => {
    it('writes the present fields + marks the delivery dirty', async () => {
      await store.writePosition('d1', new Date('2026-06-01T00:00:00.000Z'), {
        droneLat: 1.5,
        droneLng: 2.5,
        droneStatus: 'In transit',
      });

      expect(lastMulti.hset).toHaveBeenCalledWith(
        'delivery:d1:pos',
        expect.objectContaining({
          droneLat: '1.5',
          droneLng: '2.5',
          droneStatus: 'In transit',
          deliveryCreatedAt: '2026-06-01T00:00:00.000Z',
        }),
      );
      expect(lastMulti.expire).toHaveBeenCalled();
      expect(lastMulti.sadd).toHaveBeenCalledWith('tracking:dirty', 'd1');
    });

    it('omits undefined fields (an empty liveness bump still marks dirty)', async () => {
      await store.writePosition('d1', new Date('2026-06-01T00:00:00.000Z'), {});

      const fields = lastMulti.hset.mock.calls[0][1] as Record<string, string>;
      expect(fields).not.toHaveProperty('droneLat');
      expect(fields).toHaveProperty('deliveryCreatedAt');
      expect(lastMulti.sadd).toHaveBeenCalledWith('tracking:dirty', 'd1');
    });
  });

  describe('readPosition', () => {
    it('parses the hot hash into a typed position', async () => {
      client.hgetall.mockResolvedValue({
        droneLat: '1.5',
        droneLng: '2.5',
        droneStatus: 'x',
        eta: '2026-06-01T00:00:00.000Z',
        deliveryCreatedAt: '2026-05-01T00:00:00.000Z',
      });

      expect(await store.readPosition('d1')).toEqual({
        droneLat: 1.5,
        droneLng: 2.5,
        droneStatus: 'x',
        eta: new Date('2026-06-01T00:00:00.000Z'),
      });
    });

    it('returns null when the hot key is absent/expired', async () => {
      client.hgetall.mockResolvedValue({});
      expect(await store.readPosition('d1')).toBeNull();
    });
  });

  describe('drainCheckpoints', () => {
    it('flushes each dirty delivery to Postgres (skipping expired keys)', async () => {
      client.spop.mockResolvedValue(['d1', 'd2']);
      client.hgetall
        .mockResolvedValueOnce({
          deliveryCreatedAt: '2026-06-01T00:00:00.000Z',
          droneLat: '1',
          droneLng: '2',
        })
        .mockResolvedValueOnce({}); // d2 expired between SPOP and HGETALL
      prisma.deliveryTracking.upsert.mockResolvedValue({});

      const n = await store.drainCheckpoints();

      expect(n).toBe(1);
      expect(prisma.deliveryTracking.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.deliveryTracking.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deliveryId: 'd1' },
          create: expect.objectContaining({
            deliveryId: 'd1',
            deliveryCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
            droneLat: 1,
            droneLng: 2,
          }),
        }),
      );
    });

    it('re-marks a delivery dirty when its checkpoint upsert fails (retry next tick)', async () => {
      client.spop.mockResolvedValue(['d1']);
      client.hgetall.mockResolvedValue({
        deliveryCreatedAt: '2026-06-01T00:00:00.000Z',
        droneLat: '1',
        droneLng: '2',
      });
      prisma.deliveryTracking.upsert.mockRejectedValue(new Error('db down'));

      const n = await store.drainCheckpoints();

      expect(n).toBe(0);
      // Re-added to the dirty set so it isn't silently lost.
      expect(client.sadd).toHaveBeenCalledWith('tracking:dirty', 'd1');
    });

    it('is a no-op when nothing is dirty', async () => {
      client.spop.mockResolvedValue([]);
      expect(await store.drainCheckpoints()).toBe(0);
      expect(prisma.deliveryTracking.upsert).not.toHaveBeenCalled();
    });
  });

  describe('checkpoint safety invariant', () => {
    it('the default cadence clears the watchdog silence window with margin', () => {
      expect(CHECKPOINT_INTERVAL_MS * CHECKPOINT_SAFETY_FACTOR).toBeLessThan(
        WATCHDOG_SILENCE_MS,
      );
    });

    it('assertCheckpointSafe does not throw under the default (disabled) config', () => {
      expect(() => assertCheckpointSafe()).not.toThrow();
    });
  });
});
