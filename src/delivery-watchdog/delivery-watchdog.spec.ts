import { DeliveryStatus } from '@prisma/client';

import { createMockPrismaService } from '../test/prisma-mock';
import { DeliveryWatchdog } from './delivery-watchdog';
import {
  WATCHDOG_BATCH,
  WATCHDOG_SILENCE_MS,
  WATCHDOG_STUCK_STATUSES,
} from './watchdog.constants';

describe('DeliveryWatchdog', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let deliveries: { failExceptional: jest.Mock; beginReturnToBase: jest.Mock };
  let metrics: {
    watchdogReapedTotal: { inc: jest.Mock };
    watchdogLastScan: { set: jest.Mock };
    droneCommandsTotal: { inc: jest.Mock };
  };
  let watchdog: DeliveryWatchdog;

  const ago = (ms: number) => new Date(Date.now() - ms);
  const STALE = WATCHDOG_SILENCE_MS + 60_000;
  const FRESH = 1_000;

  // A candidate row as the (pre-filtered) scan would return it.
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'd-1',
    status: DeliveryStatus.IN_TRANSIT,
    failureReason: null,
    updatedAt: ago(STALE),
    tracking: { updatedAt: ago(STALE) },
    ...over,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    deliveries = {
      failExceptional: jest.fn().mockResolvedValue(true),
      beginReturnToBase: jest.fn().mockResolvedValue(true),
    };
    metrics = {
      watchdogReapedTotal: { inc: jest.fn() },
      watchdogLastScan: { set: jest.fn() },
      droneCommandsTotal: { inc: jest.fn() },
    };
    // Command housekeeping runs each tick; default to "nothing stale / nothing stranded".
    prisma.droneCommand.groupBy.mockResolvedValue([]); // expiry sweep: nothing
    prisma.droneCommand.updateMany.mockResolvedValue({ count: 0 });
    prisma.droneCommand.findMany.mockResolvedValue([]); // reconcile: nothing stranded
    watchdog = new DeliveryWatchdog(
      prisma as any,
      deliveries as any,
      metrics as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('reaps a stuck LIVE IN_TRANSIT delivery (silent telemetry) → DELIVERY_FAILED/MECHANICAL (#15)', async () => {
    prisma.delivery.findMany.mockResolvedValue([row()]);
    await watchdog.scanAndReap();
    expect(deliveries.failExceptional).toHaveBeenCalledTimes(1);
    expect(deliveries.failExceptional).toHaveBeenCalledWith(
      'd-1',
      'MECHANICAL',
    );
    // Reap is counted by status, and the heartbeat gauge advances.
    expect(metrics.watchdogReapedTotal.inc).toHaveBeenCalledWith({
      status: DeliveryStatus.IN_TRANSIT,
    });
    expect(metrics.watchdogLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('reaps a stuck LIVE RETURNING delivery (dead return flight) (#16)', async () => {
    prisma.delivery.findMany.mockResolvedValue([
      row({ id: 'd-2', status: DeliveryStatus.RETURNING }),
    ]);
    await watchdog.scanAndReap();
    expect(deliveries.failExceptional).toHaveBeenCalledWith(
      'd-2',
      'MECHANICAL',
    );
  });

  it('preserves a reason already stamped at the abort instead of overwriting it with MECHANICAL', async () => {
    // A weather-aborted return flight that then goes silent must reap as
    // WEATHER_ABORT, not have its recorded cause flipped to MECHANICAL.
    prisma.delivery.findMany.mockResolvedValue([
      row({
        id: 'd-3',
        status: DeliveryStatus.RETURNING,
        failureReason: 'WEATHER_ABORT',
      }),
    ]);
    await watchdog.scanAndReap();
    expect(deliveries.failExceptional).toHaveBeenCalledWith(
      'd-3',
      'WEATHER_ABORT',
    );
  });

  it('does NOT reap a delivery whose tracking is still fresh (defensive in-loop re-check)', async () => {
    // The SQL gate already excludes fresh rows; this proves the belt-and-suspenders
    // re-check still skips one that slipped through (a frame landed since the read).
    prisma.delivery.findMany.mockResolvedValue([
      row({ updatedAt: ago(STALE), tracking: { updatedAt: ago(FRESH) } }),
    ]);
    await watchdog.scanAndReap();
    expect(deliveries.failExceptional).not.toHaveBeenCalled();
    // Even a no-reap tick advances the heartbeat (the scan completed).
    expect(metrics.watchdogLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('falls back to delivery.updatedAt when there is no tracking row', async () => {
    prisma.delivery.findMany.mockResolvedValue([
      row({ tracking: null, updatedAt: ago(STALE) }), // stale → reap
      row({ id: 'd-fresh', tracking: null, updatedAt: ago(FRESH) }), // fresh → skip
    ]);
    await watchdog.scanAndReap();
    expect(deliveries.failExceptional).toHaveBeenCalledTimes(1);
    expect(deliveries.failExceptional).toHaveBeenCalledWith(
      'd-1',
      'MECHANICAL',
    );
  });

  it('gates silence on the TRACKING row (not phase-change time), LIVE-only, excludes AWAITING_HANDOFF, bounded', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    await watchdog.scanAndReap();
    const args = prisma.delivery.findMany.mock.calls[0][0];
    const where = args.where;
    expect(where.trackingSource).toBe('LIVE');
    expect(where.status.in).toEqual(WATCHDOG_STUCK_STATUSES);
    expect(where.status.in).not.toContain(DeliveryStatus.AWAITING_HANDOFF);
    expect(where.createdAt.lt).toBeInstanceOf(Date); // never a brand-new delivery
    // Silence keyed on tracking.updatedAt (with a null-tracking fallback to the
    // delivery row) — NOT a bare delivery.updatedAt gate that would let healthy
    // long-haul flights crowd the batch.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].tracking.is.updatedAt.lt).toBeInstanceOf(Date);
    expect(where.OR[1].tracking.is).toBeNull();
    expect(where.OR[1].updatedAt.lt).toBeInstanceOf(Date);
    // Ordered by silence (tracking.updatedAt) first, delivery.updatedAt as tiebreak.
    expect(args.orderBy[0].tracking.updatedAt).toBe('asc');
    expect(args.take).toBe(WATCHDOG_BATCH);
  });

  it('empty scan is a no-op (still heartbeats)', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    await expect(watchdog.scanAndReap()).resolves.toBeUndefined();
    expect(deliveries.failExceptional).not.toHaveBeenCalled();
    expect(metrics.watchdogLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('expires stale drone commands (open + past TTL) each tick, counted PER TYPE', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    prisma.droneCommand.groupBy.mockResolvedValue([
      { type: 'RETURN_TO_BASE', _count: { _all: 2 } },
      { type: 'ABORT', _count: { _all: 1 } },
    ]);
    prisma.droneCommand.updateMany.mockResolvedValue({ count: 3 });
    await watchdog.scanAndReap();
    const upd = prisma.droneCommand.updateMany.mock.calls[0][0];
    expect(upd.where.status.in).toEqual(['PENDING', 'FETCHED']);
    expect(upd.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(upd.data.status).toBe('EXPIRED');
    // Real DroneCommandType labels — never a synthetic "all" aggregate.
    expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith(
      { type: 'RETURN_TO_BASE', result: 'expired' },
      2,
    );
    expect(metrics.droneCommandsTotal.inc).toHaveBeenCalledWith(
      { type: 'ABORT', result: 'expired' },
      1,
    );
    expect(metrics.watchdogLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('skips the expiry UPDATE entirely when nothing is stale', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    prisma.droneCommand.groupBy.mockResolvedValue([]);
    await watchdog.scanAndReap();
    expect(prisma.droneCommand.updateMany).not.toHaveBeenCalled();
  });

  it('reconciles a stranded ACKED command by re-driving its transition (#1)', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    prisma.droneCommand.findMany.mockResolvedValue([
      {
        id: 'c-1',
        deliveryId: 'd-1',
        type: 'RETURN_TO_BASE',
        reason: 'WEATHER_ABORT',
      },
    ]);
    await watchdog.scanAndReap();
    // Re-driven with the operator's ORIGINAL type+reason (not a MECHANICAL reap).
    expect(deliveries.beginReturnToBase).toHaveBeenCalledWith('d-1', 'WEATHER_ABORT');
    const sel = prisma.droneCommand.findMany.mock.calls[0][0];
    expect(sel.where.status).toBe('ACKED');
    expect(sel.where.appliedTransition).toBe(false);
    expect(sel.where.ackedAt.lt).toBeInstanceOf(Date);
    expect(prisma.droneCommand.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { appliedTransition: true },
    });
  });

  it('resolves a stranded ACKED command to REJECTED when the delivery already settled', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    prisma.droneCommand.findMany.mockResolvedValue([
      { id: 'c-2', deliveryId: 'd-2', type: 'ABORT', reason: 'ADMIN_ABORT' },
    ]);
    deliveries.failExceptional.mockResolvedValue(false); // delivery already terminal
    await watchdog.scanAndReap();
    expect(prisma.droneCommand.update).toHaveBeenCalledWith({
      where: { id: 'c-2' },
      data: expect.objectContaining({ status: 'REJECTED' }),
    });
  });

  it('a failing command-housekeeping step never blocks the heartbeat', async () => {
    prisma.delivery.findMany.mockResolvedValue([]);
    prisma.droneCommand.groupBy.mockRejectedValue(new Error('db blip'));
    prisma.droneCommand.findMany.mockRejectedValue(new Error('db blip'));
    await expect(watchdog.scanAndReap()).resolves.toBeUndefined();
    expect(metrics.watchdogLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('isolates a per-row failure so the rest of the tick still runs', async () => {
    prisma.delivery.findMany.mockResolvedValue([
      row({ id: 'd-a' }),
      row({ id: 'd-b' }),
    ]);
    deliveries.failExceptional
      .mockRejectedValueOnce(new Error('boom')) // d-a throws
      .mockResolvedValueOnce(true); // d-b still attempted
    await expect(watchdog.scanAndReap()).resolves.toBeUndefined();
    expect(deliveries.failExceptional).toHaveBeenCalledTimes(2);
    expect(deliveries.failExceptional).toHaveBeenCalledWith(
      'd-b',
      'MECHANICAL',
    );
    // A partial tick still completed the scan → heartbeat advances.
    expect(metrics.watchdogLastScan.set).toHaveBeenCalledTimes(1);
  });
});
