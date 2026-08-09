import { Logger } from '@nestjs/common';

import { MetricsService } from '../metrics/metrics.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { AirspaceService } from './airspace.service';
import {
  AIRSPACE_CACHE_TTL_MAX_MS,
  resolveAirspaceCacheTtlMs,
} from './airspace.constants';

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
  let metrics: { airspaceZonesInForce: { set: jest.Mock } };
  let service: AirspaceService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.airspaceZone.findMany.mockResolvedValue([zone()]);
    metrics = { airspaceZonesInForce: { set: jest.fn() } };
    service = new AirspaceService(
      prisma as never,
      metrics as unknown as MetricsService,
    );
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

  it('applies the window to CACHED rows, so a zone entering force by the clock needs no re-read', async () => {
    // The one fail-OPEN window this service used to have, in a service written to fail
    // closed. The cache held the already-window-filtered list, so the window was
    // evaluated once per fill: a pre-staged TFR — the entire reason a window exists —
    // went unenforced for up to a full TTL on EVERY instance, including the one that
    // created it. The database read is cached; the clock is not.
    //
    // Times are relative to Date.now() so the default 30s TTL genuinely spans them and
    // this cannot rot into passing for the wrong reason.
    const t0 = Date.now();
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ activeFrom: new Date(t0 + 5_000) }),
    ]);

    await expect(service.inForceZones(new Date(t0))).resolves.toEqual([]);
    await expect(
      service.inForceZones(new Date(t0 + 10_000)),
    ).resolves.toHaveLength(1);

    // Still one query: the row never left memory, only the answer changed.
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(1);
  });

  it('drops a zone whose window closes mid-TTL, also without a re-read', async () => {
    // The same property in the other direction. Both matter: caching the ANSWER makes
    // the service wrong at both edges of the window, not just the opening one.
    const t0 = Date.now();
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ activeUntil: new Date(t0 + 5_000) }),
    ]);

    await expect(service.inForceZones(new Date(t0))).resolves.toHaveLength(1);
    await expect(service.inForceZones(new Date(t0 + 10_000))).resolves.toEqual(
      [],
    );

    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(1);
  });

  it('publishes the IN-FORCE count to the gauge on a cache fill', async () => {
    // In production an empty zone list is indistinguishable from "there is no restricted
    // airspace" — a failed seed, a truncated table and a genuinely clear registry all
    // read identically, and every guard on this branch lives in CI against a database
    // `migrate deploy` just built. This gauge is what makes `== 0` alertable.
    const t0 = Date.now();
    prisma.airspaceZone.findMany.mockResolvedValue([
      zone({ name: 'In force' }),
      // Fetched (it is `active`) but expired — counted as protection it would overstate
      // exactly the thing the gauge exists to measure.
      zone({ name: 'Expired', activeUntil: new Date(t0 - 1_000) }),
    ]);

    await service.inForceZones(new Date(t0));

    expect(metrics.airspaceZonesInForce.set).toHaveBeenCalledWith(1);
  });

  it('leaves the gauge untouched when the query throws', async () => {
    // A stale reading is recoverable. A confident `0` published from a failed read is
    // strictly worse than none: it looks freshly measured, and it silences the alert
    // that should be firing at the exact moment the airspace can no longer be verified.
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    prisma.airspaceZone.findMany.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(service.inForceZones()).rejects.toThrow('connection reset');

    expect(metrics.airspaceZonesInForce.set).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('works without a MetricsService (it is optional)', async () => {
    // Observability must never be the reason an airspace read fails, and the DB-backed
    // spec constructs this service with prisma alone.
    const bare = new AirspaceService(prisma as never);
    await expect(bare.inForceZones()).resolves.toHaveLength(1);
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
    //
    // `now` here is relative to Date.now() at test time, NOT a hardcoded calendar
    // date. A mutant that poisons the cache stamps it with the real wall clock
    // (`Date.now()`), not the caller's `now` — catching that requires this test's
    // fixture times to stay near the real clock. A hardcoded past date drifts
    // further behind Date.now() with every day this suite isn't touched, until the
    // `at >= this.cache.at` freshness guard (added for the backwards-clock fix)
    // rejects the poisoned entry outright and forces a legitimate re-query for the
    // WRONG reason — silently disarming this test without it ever going red.
    const t0 = Date.now();
    prisma.airspaceZone.findMany.mockRejectedValueOnce(
      new Error('connection reset'),
    );

    await expect(service.inForceZones(new Date(t0))).rejects.toThrow();
    await expect(
      service.inForceZones(new Date(t0 + 1_000)),
    ).resolves.toHaveLength(1);
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('resolveAirspaceCacheTtlMs', () => {
  it('passes through a positive override', () => {
    expect(resolveAirspaceCacheTtlMs(1500)).toBe(1500);
  });

  it('honors an explicit 0 (no caching) rather than falling back', () => {
    // `Number(env) || fallback` — the bug this function replaced — treats 0 as
    // falsy and silently returns the fallback instead. This is the one case that
    // bug got backwards in the "disable the cache" direction.
    expect(resolveAirspaceCacheTtlMs(0)).toBe(0);
  });

  it('rejects a negative override in favor of the fallback', () => {
    // The same old bug let a negative value through unchecked, which disables the
    // cache too, but by accident and in the opposite direction from intent.
    expect(resolveAirspaceCacheTtlMs(-5)).toBe(30_000);
  });

  it('rejects a non-finite override (NaN) in favor of the fallback', () => {
    expect(resolveAirspaceCacheTtlMs(NaN)).toBe(30_000);
  });

  it('accepts the maximum exactly', () => {
    // The bound is inclusive; the rejection starts one millisecond later.
    expect(resolveAirspaceCacheTtlMs(AIRSPACE_CACHE_TTL_MAX_MS)).toBe(
      AIRSPACE_CACHE_TTL_MAX_MS,
    );
  });

  it('rejects an absurdly large override in favor of the fallback', () => {
    // `AIRSPACE_CACHE_TTL_MS=999999999` used to be accepted in silence: an eleven-day
    // cache on a safety surface, from a typo nobody would ever see. The TTL bounds how
    // long a replica can keep serving zone rows before re-reading them, so an unbounded
    // override is an unbounded window in which an operator's new restriction is invisible
    // everywhere but the instance that wrote it.
    expect(resolveAirspaceCacheTtlMs(999_999_999)).toBe(30_000);
    expect(resolveAirspaceCacheTtlMs(AIRSPACE_CACHE_TTL_MAX_MS + 1)).toBe(
      30_000,
    );
  });

  it('falls back rather than CLAMPING an over-large override', () => {
    // Clamping would honor half of a value that was plainly a mistake, and leave the
    // deployment running at a five-minute TTL nobody chose. The default is the only
    // number anyone reviewed.
    expect(resolveAirspaceCacheTtlMs(999_999_999)).not.toBe(
      AIRSPACE_CACHE_TTL_MAX_MS,
    );
  });
});
