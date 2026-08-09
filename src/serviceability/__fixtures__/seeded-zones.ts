import { GeoCircle } from '../serviceability.types';

/**
 * The zones the migration seeds into `airspace_zones` — MUST mirror the INSERT in
 * prisma/migrations/20260809133410_add_airspace_zones/migration.sql, verbatim.
 *
 * This is the default zone list for every test in serviceability.service.spec.ts,
 * because it is what the deleted NO_FLY_ZONES constant used to be: under the constant
 * these two zones were in force for the whole file, so `passes the Bandung demo route`
 * proved the Jakarta airports do NOT reach the demo. Defaulting to [] instead would
 * leave that test green while it silently stopped proving anything.
 *
 * Drift between this fixture and the real database is what would make every
 * serviceability test assert against airspace that does not exist. Two specs exist to
 * stop that, and they close different halves of it:
 *   - airspace-seed.spec.ts — parses the migration SQL and deep-equals it to this
 *     constant. No database needed, so it runs everywhere, always.
 *   - airspace.db.spec.ts   — queries a real seeded database through AirspaceService
 *     and deep-equals THAT to this constant. Runs wherever DATABASE_URL is set,
 *     including CI.
 *
 * Lives in __fixtures__/ rather than in the spec itself deliberately: exporting it
 * from a *.spec.ts would mean any importer re-registers that file's whole `describe`
 * block and silently re-runs all of its tests as part of the importing suite.
 */
export const SEEDED_ZONES: GeoCircle[] = [
  {
    name: 'Soekarno-Hatta International Airport',
    lat: -6.1256,
    lng: 106.6558,
    radiusKm: 5,
  },
  {
    name: 'Halim Perdanakusuma Airport',
    lat: -6.2647,
    lng: 106.9308,
    radiusKm: 3,
  },
];

/** The migration whose INSERT this fixture mirrors. */
export const AIRSPACE_SEED_MIGRATION =
  'prisma/migrations/20260809133410_add_airspace_zones/migration.sql';
