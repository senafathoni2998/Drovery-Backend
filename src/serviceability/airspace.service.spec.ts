import { Logger } from '@nestjs/common';

import { createMockPrismaService } from '../test/prisma-mock';
import { AirspaceService } from './airspace.service';

const zone = (over: Record<string, unknown> = {}) => ({
  id: 'z-1',
  name: 'Soekarno-Hatta International Airport',
  kind: 'AIRPORT',
  lat: -6.1256,
  lng: 106.6558,
  radiusKm: 5,
  floorM: null,
  ceilingM: null,
  activeFrom: null,
  activeUntil: null,
  active: true,
  ...over,
});

describe('AirspaceService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: AirspaceService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.airspaceZone.findMany.mockResolvedValue([zone()]);
    service = new AirspaceService(prisma as never);
  });

  it('returns in-force zones as the geometry shape the checker already uses', async () => {
    await expect(service.inForceZones()).resolves.toEqual([
      {
        name: 'Soekarno-Hatta International Airport',
        lat: -6.1256,
        lng: 106.6558,
        radiusKm: 5,
      },
    ]);
  });

  it('asks the database only for zones that are switched on', async () => {
    await service.inForceZones();

    // The kill-switch is the cheap, indexed half of "in force"; the time window is
    // applied on top. Fetching disabled rows and filtering in memory would work and
    // would also scan a table that grows with every retired TFR.
    expect(prisma.airspaceZone.findMany.mock.calls[0][0].where).toMatchObject({
      active: true,
    });
  });

  it('excludes a zone whose window has not opened yet', async () => {
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ activeFrom: new Date('2026-09-01T00:00:00Z') }),
    ]);

    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:00Z')),
    ).resolves.toEqual([]);
  });

  it('excludes a zone whose window has closed', async () => {
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ activeUntil: new Date('2026-07-01T00:00:00Z') }),
    ]);

    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:00Z')),
    ).resolves.toEqual([]);
  });

  it('includes a zone inside its window', async () => {
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({
        activeFrom: new Date('2026-08-01T00:00:00Z'),
        activeUntil: new Date('2026-08-03T00:00:00Z'),
      }),
    ]);

    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:00Z')),
    ).resolves.toHaveLength(1);
  });

  it('includes a zone exactly at its activeFrom boundary (the window opens inclusively)', async () => {
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ activeFrom: new Date('2026-08-02T00:00:00Z') }),
    ]);

    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:00Z')),
    ).resolves.toHaveLength(1);
  });

  it('includes a zone exactly at its activeUntil boundary (the window closes inclusively)', async () => {
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ activeUntil: new Date('2026-08-02T00:00:00Z') }),
    ]);

    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:00Z')),
    ).resolves.toHaveLength(1);
  });

  it('caches within the TTL, then refreshes', async () => {
    await service.inForceZones(new Date('2026-08-02T00:00:00Z'));
    await service.inForceZones(new Date('2026-08-02T00:00:10Z'));
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(1);

    await service.inForceZones(new Date('2026-08-02T00:01:00Z'));
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(2);
  });

  it('re-queries rather than serving the cache when `now` is earlier than the fill time', async () => {
    // The unsigned form of the TTL check (`at - cache.at < TTL`) is always true for a
    // negative difference, so a caller passing a `now` behind the fill time would get
    // served the cache forever. `now` is a caller-supplied parameter precisely so a
    // future caller (Task 3) can pass one — a clock that appears to run backwards must
    // not be treated as "still within the TTL".
    await service.inForceZones(new Date('2026-08-02T00:01:00Z'));
    await service.inForceZones(new Date('2026-08-02T00:00:00Z'));

    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(2);
  });

  it('serves a fresh read immediately after an invalidate', async () => {
    // An operator adding an emergency TFR needs it live in seconds, not at TTL expiry.
    await service.inForceZones(new Date('2026-08-02T00:00:00Z'));
    service.invalidate();
    await service.inForceZones(new Date('2026-08-02T00:00:01Z'));

    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(2);
  });

  it('throws rather than reporting empty airspace when the query fails', async () => {
    // The caller turns this into a hard block. Returning [] here would mean a DB blip
    // reads as "no restricted airspace anywhere", which is the one answer that must
    // never be produced by accident.
    //
    // Also asserts the ops warning actually fires: `fetchActiveRows` MUST `return
    // await` the query rather than just `return` it — otherwise its try/catch never
    // observes the rejection (it resolves the method's own promise immediately with
    // the still-pending one), the warn silently never runs, and the only symptom is a
    // missing log line during a real incident.
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    prisma.airspaceZone.findMany.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(service.inForceZones()).rejects.toThrow('connection reset');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('connection reset'),
    );
    warnSpy.mockRestore();
  });

  it('does not cache a failure', async () => {
    // Otherwise one bad query opens the airspace for a whole TTL.
    prisma.airspaceZone.findMany.mockRejectedValueOnce(
      new Error('connection reset'),
    );

    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:00Z')),
    ).rejects.toThrow();
    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:01Z')),
    ).resolves.toHaveLength(1);
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(2);
  });
});
