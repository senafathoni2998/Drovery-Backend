import { PartitionMaintenanceService } from './partition-maintenance.service';

// DB-free: the plpgsql routines are exercised by scripts/verify-partitions.sql + the
// guarded integration spec; here we assert the service's orchestration (order, per-table
// isolation, metrics, heartbeat) against a mocked $queryRawUnsafe.
describe('PartitionMaintenanceService', () => {
  let prisma: { $queryRawUnsafe: jest.Mock };
  let metrics: {
    partitionsCreatedTotal: { inc: jest.Mock };
    partitionsDroppedTotal: { inc: jest.Mock };
    partitionDefaultRows: { set: jest.Mock };
    partitionLastScan: { set: jest.Mock };
    partitionMaintenanceFailures: { inc: jest.Mock };
    partitionOldestLeafAgeMonths: { set: jest.Mock };
  };
  let service: PartitionMaintenanceService;

  beforeEach(() => {
    prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ n: 0 }]) };
    metrics = {
      partitionsCreatedTotal: { inc: jest.fn() },
      partitionsDroppedTotal: { inc: jest.fn() },
      partitionDefaultRows: { set: jest.fn() },
      partitionLastScan: { set: jest.fn() },
      partitionMaintenanceFailures: { inc: jest.fn() },
      partitionOldestLeafAgeMonths: { set: jest.fn() },
    };
    service = new PartitionMaintenanceService(
      prisma as never,
      metrics as never,
    );
  });

  it('drains then ensures (retention skipped by default), counts the default, and stamps the heartbeat', async () => {
    await service.run();
    const sqls = prisma.$queryRawUnsafe.mock.calls.map((c) => c[0] as string);

    const drainIdx = sqls.findIndex((s) =>
      s.includes('partition_drain_default'),
    );
    const ensureIdx = sqls.findIndex((s) => s.includes('partition_ensure'));
    expect(drainIdx).toBeGreaterThanOrEqual(0);
    expect(ensureIdx).toBeGreaterThan(drainIdx); // drain runs FIRST (default-constraint safety)
    expect(sqls.some((s) => s.includes('partition_drop_old'))).toBe(false); // RETAIN=0 → disabled
    expect(sqls.some((s) => s.includes('count(*)'))).toBe(true);

    // Default-rows gauge is always set (alertable); for the single 'notifications' table.
    expect(metrics.partitionDefaultRows.set).toHaveBeenCalledWith(
      { table: 'notifications' },
      0,
    );
    // Heartbeat stamped after the loop.
    expect(metrics.partitionLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('increments the created counter when partitions are made', async () => {
    // drain → 1 created, ensure → 2 created, count → 0.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ n: 1 }]) // drain_default
      .mockResolvedValueOnce([{ n: 2 }]) // ensure
      .mockResolvedValueOnce([{ n: 0 }]); // count default
    await service.run();
    expect(metrics.partitionsCreatedTotal.inc).toHaveBeenCalledWith(
      { table: 'notifications' },
      3,
    );
  });

  it('isolates a per-table failure, increments the failure counter (alertable), and still stamps the heartbeat', async () => {
    prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('boom')); // drain throws for the first table
    await expect(service.run()).resolves.toBeUndefined();
    // The swallow must be OBSERVABLE — a silently-failing retention reclaims nothing.
    expect(metrics.partitionMaintenanceFailures.inc).toHaveBeenCalledWith({
      table: 'notifications',
    });
    expect(metrics.partitionLastScan.set).toHaveBeenCalledTimes(1);
  });

  it('sets the oldest-leaf retention-lag gauge per table (independent of the DEFAULT)', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ n: 7 }]); // every read returns 7 months
    await service.run();
    expect(metrics.partitionOldestLeafAgeMonths.set).toHaveBeenCalledWith(
      { table: 'notifications' },
      7,
    );
  });
});
