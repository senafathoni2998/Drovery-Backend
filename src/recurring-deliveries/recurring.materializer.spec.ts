import { createMockPrismaService } from '../test/prisma-mock';
import { RecurringMaterializer } from './recurring.materializer';

describe('RecurringMaterializer', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let deliveries: { create: jest.Mock };
  let mat: RecurringMaterializer;

  const baseSchedule = (over: Record<string, unknown> = {}) => ({
    id: 'r-1',
    userId: 'u-1',
    freq: 'DAILY',
    daysOfWeek: [],
    timeOfDay: '08:00',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: null,
    nextRunAt: new Date(Date.now() + 60_000), // 1 min out: within horizon, not missed
    fromAddress: 'A',
    toAddress: 'B',
    fromLat: -6.9,
    fromLng: 107.6,
    toLat: -6.92,
    toLng: 107.62,
    receiver: 'R',
    packages: 'Box',
    packageSize: 'Medium',
    packageWeight: 2,
    packageTypes: ['electronics'],
    ...over,
  });

  beforeEach(() => {
    // Freeze the clock to a fixed instant so these scenarios are deterministic
    // regardless of wall-clock: 02:00 UTC = 09:00 WIB (service tz, no DST). This
    // keeps the next service-tz-aligned 08:00 occurrence > 6h (LOOKAHEAD_MS) away,
    // so a baseSchedule (nextRunAt = now+60s) yields exactly ONE in-window
    // occurrence. Run between ~02:00–08:00 WIB on a real clock, a second aligned
    // occurrence falls inside the lookahead and the count assertions flake.
    jest.useFakeTimers({ now: new Date('2026-03-16T02:00:00.000Z') });
    prisma = createMockPrismaService();
    deliveries = { create: jest.fn().mockResolvedValue({ id: 'd-1' }) };
    prisma.recurringDelivery.updateMany.mockResolvedValue({ count: 1 });
    mat = new RecurringMaterializer(prisma as any, deliveries as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('claims an occurrence (CAS) and creates a delivery once', async () => {
    prisma.recurringDelivery.findMany.mockResolvedValue([baseSchedule()]);

    await mat.scanAndMaterialize();

    // CAS advances the cursor on the exact nextRunAt we read.
    const cas = prisma.recurringDelivery.updateMany.mock.calls[0][0];
    expect(cas.where).toMatchObject({ id: 'r-1', active: true });
    expect(cas.where.nextRunAt).toBeInstanceOf(Date);
    expect(deliveries.create).toHaveBeenCalledTimes(1);
    const [uid, dto] = deliveries.create.mock.calls[0];
    expect(uid).toBe('u-1');
    expect(dto.pickupTime).toBe('08:00');
    expect(dto.pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dto.receiver).toBe('R');
    expect(dto.packageTypes).toEqual(['electronics']);
  });

  it('does NOT create when the CAS is lost (another replica won)', async () => {
    prisma.recurringDelivery.findMany.mockResolvedValue([baseSchedule()]);
    prisma.recurringDelivery.updateMany.mockResolvedValue({ count: 0 });

    await mat.scanAndMaterialize();

    expect(deliveries.create).not.toHaveBeenCalled();
  });

  it('skips a missed occurrence (no backfill) and fast-forwards the cursor', async () => {
    prisma.recurringDelivery.findMany.mockResolvedValue([
      baseSchedule({ nextRunAt: new Date(Date.now() - 6 * 60 * 60 * 1000) }), // 6h stale
    ]);

    await mat.scanAndMaterialize();

    expect(deliveries.create).not.toHaveBeenCalled();
    // The cursor was still advanced (claimed) via the CAS.
    expect(prisma.recurringDelivery.updateMany).toHaveBeenCalled();
  });

  it('still materializes an occurrence that is only barely late (within grace)', async () => {
    prisma.recurringDelivery.findMany.mockResolvedValue([
      baseSchedule({ nextRunAt: new Date(Date.now() - 30_000) }), // 30s late < 120s grace
    ]);

    await mat.scanAndMaterialize();

    expect(deliveries.create).toHaveBeenCalledTimes(1);
  });

  it('isolates a create() failure (weather/out-of-area) — scan resolves, no throw', async () => {
    prisma.recurringDelivery.findMany.mockResolvedValue([baseSchedule()]);
    deliveries.create.mockRejectedValue(new Error('weather hold'));

    await expect(mat.scanAndMaterialize()).resolves.toBeUndefined();
    expect(deliveries.create).toHaveBeenCalledTimes(1); // attempted, cursor already advanced
  });

  it('bounds the scan batch size', async () => {
    prisma.recurringDelivery.findMany.mockResolvedValue([]);
    await mat.scanAndMaterialize();
    expect(prisma.recurringDelivery.findMany.mock.calls[0][0].take).toBe(200);
  });
});
