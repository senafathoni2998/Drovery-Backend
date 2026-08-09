import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { SEEDED_ZONES } from './__fixtures__/seeded-zones';
import { AirspaceService } from './airspace.service';
import { ServiceabilityService } from './serviceability.service';
import { GeoCircle } from './serviceability.types';
import { WeatherService } from './weather.service';

/**
 * The half of the drift problem that no mock can close: whether the seeded rows
 * actually reach the geometry.
 *
 * Every other serviceability test stubs inForceZones, so the suite would stay green
 * with an empty airspace_zones table, a failed seed, or a renamed column — while the
 * two airports this system exists to protect were wide open. This spec runs the real
 * chain: PrismaClient -> AirspaceService -> ServiceabilityService, no mocks except
 * weather (stubbed only so the assertions are about airspace, not the forecast).
 *
 * It runs in CI today with no config change: .github/workflows/ci.yml starts Postgres,
 * sets DATABASE_URL, runs `prisma migrate deploy` — which executes the seed INSERT —
 * and then runs `npm test`, and jest's rootDir is `src`.
 */
const dbDescribe = process.env.DATABASE_URL ? describe : describe.skip;

const byName = (zones: GeoCircle[]): GeoCircle[] =>
  [...zones].sort((a, b) => a.name.localeCompare(b.name));

// Soekarno-Hatta, from the seed: -6.1256, 106.6558, 5 km.
const CGK = { lat: -6.1256, lng: 106.6558 };

describe('airspace DB coverage', () => {
  it('is not silently skipped in CI', () => {
    // Deliberately OUTSIDE the guard above. A skipped test reports green, so without
    // this the DB coverage below could evaporate — someone drops DATABASE_URL from the
    // workflow — and every signal we have would still say the suite passed.
    if (process.env.CI) expect(process.env.DATABASE_URL).toBeDefined();
  });
});

dbDescribe('airspace, against a real seeded database', () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let airspace: AirspaceService;
  let service: ServiceabilityService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool as never) });
    await prisma.$connect();

    airspace = new AirspaceService(prisma as never);

    const weather = {
      getConditions: () =>
        Promise.resolve({
          windKph: 5,
          condition: 'clear',
          flyable: true,
          source: 'mock',
        }),
    } as unknown as WeatherService;

    service = new ServiceabilityService(weather, airspace);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  it('reads exactly the seeded zones out of the database', async () => {
    const zones = await airspace.inForceZones();

    // Chains this to airspace-seed.spec.ts: that one proves the fixture matches the
    // migration, this one proves the database matches the fixture. Together they
    // pin migration -> database -> geometry.
    expect(zones.length).toBeGreaterThan(0);
    expect(byName(zones)).toEqual(byName(SEEDED_ZONES));
  }, 30_000);

  it('refuses a route ENDING at Soekarno-Hatta', async () => {
    const result = await service.checkServiceability(
      -6.2088,
      106.8456, // Jakarta centre
      CGK.lat,
      CGK.lng,
    );

    expect(result.serviceable).toBe(false);
    expect(result.codes).toContain('NO_FLY_ZONE');
    expect(result.params).toMatchObject({
      zoneName: 'Soekarno-Hatta International Airport',
    });
  }, 30_000);

  it('refuses a route passing THROUGH Soekarno-Hatta with both endpoints clear', async () => {
    // Due east-west across CGK at its own latitude, +-0.055 deg lng (~6.1 km, so both
    // endpoints sit outside the 5 km circle) and both still inside Greater Jakarta.
    const result = await service.checkServiceability(
      CGK.lat,
      106.6008,
      CGK.lat,
      106.7108,
    );

    expect(result.serviceable).toBe(false);
    expect(result.codes).toContain('NO_FLY_ZONE');
    expect(result.params).toMatchObject({
      zoneName: 'Soekarno-Hatta International Airport',
    });
  }, 30_000);

  it('still flies the Bandung demo route', async () => {
    // The executable form of the rationale that used to sit above NO_FLY_ZONES: the
    // Jakarta airports are ~110 km away, so seeding them does not ground the demo.
    // Previously that was prose in a comment; now it is checked against real rows.
    const result = await service.checkServiceability(
      -6.903,
      107.615,
      -6.922,
      107.607,
    );

    expect(result).toEqual({
      serviceable: true,
      reasons: [],
      codes: [],
      weatherHold: false,
    });
  }, 30_000);
});
