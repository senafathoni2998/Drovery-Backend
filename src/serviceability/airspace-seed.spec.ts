import { readFileSync } from 'fs';
import { join } from 'path';

import {
  AIRSPACE_SEED_MIGRATION,
  SEEDED_ZONES,
} from './__fixtures__/seeded-zones.fixture';
import { GeoCircle } from './serviceability.types';

/**
 * The fixture half of the drift problem, closed without a database.
 *
 * SEEDED_ZONES is hand-copied from the migration's INSERT, and every test in
 * serviceability.service.spec.ts asserts against it. If the two ever diverge, that
 * whole file starts proving things about airspace the database does not contain —
 * green the entire time. This spec parses the migration and compares.
 *
 * airspace.db.spec.ts closes the other half (fixture vs. the live seeded table).
 */

/** Split on commas that are not inside a quoted string or nested parens. */
function splitTopLevel(sql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inQuote) {
      // '' is an escaped single quote inside a SQL string literal.
      if (ch === "'" && sql[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      if (ch === "'") inQuote = false;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Strip the wrapping parens of a `( ... )` group. */
function unwrap(group: string): string {
  return group.trim().replace(/^\(/, '').replace(/\)$/, '');
}

function parseSeededZones(sql: string): GeoCircle[] {
  // Isolate the airspace_zones INSERT so an unrelated INSERT elsewhere in the file
  // can never be scooped up by the tuple scan below.
  const statement = /INSERT INTO "airspace_zones"([\s\S]*?);/.exec(sql);
  if (!statement) return [];

  const [columnList, valueList] = statement[1].split(/\bVALUES\b/);
  if (valueList === undefined) return [];

  // Map by COLUMN NAME, never by position — reordering the INSERT's columns would
  // otherwise silently swap lat and lng and still parse "successfully".
  const columns = splitTopLevel(unwrap(columnList)).map((c) =>
    c.trim().replace(/"/g, ''),
  );
  const at = (row: string[], name: string): string | undefined => {
    const index = columns.indexOf(name);
    return index === -1 ? undefined : row[index];
  };

  const zones: GeoCircle[] = [];
  for (const group of splitTopLevel(valueList)) {
    const row = splitTopLevel(unwrap(group));
    if (row.length !== columns.length) continue;

    const name = at(row, 'name');
    const lat = at(row, 'lat');
    const lng = at(row, 'lng');
    const radiusKm = at(row, 'radiusKm');
    if (!name || !lat || !lng || !radiusKm) continue;

    zones.push({
      name: name.trim().replace(/^'|'$/g, '').replace(/''/g, "'"),
      lat: Number(lat),
      lng: Number(lng),
      radiusKm: Number(radiusKm),
    });
  }
  return zones;
}

const byName = (zones: GeoCircle[]): GeoCircle[] =>
  [...zones].sort((a, b) => a.name.localeCompare(b.name));

describe('airspace seed ⇔ SEEDED_ZONES fixture', () => {
  const migrationPath = join(__dirname, '..', '..', AIRSPACE_SEED_MIGRATION);
  const parsed = parseSeededZones(readFileSync(migrationPath, 'utf8'));

  it('parses at least one zone out of the migration', () => {
    // Guards the vacuous pass: a regex that silently matches nothing would make the
    // deep-equal below compare [] to [] the moment the fixture were also emptied, and
    // would report drift as "no rows" rather than as a mismatch.
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed).toHaveLength(SEEDED_ZONES.length);
  });

  it('matches the fixture exactly, order-insensitively', () => {
    expect(byName(parsed)).toEqual(byName(SEEDED_ZONES));
  });

  it('parses the zones the geometry actually needs, not just any rows', () => {
    // A parser that returned {name: undefined, lat: NaN, ...} would satisfy a loose
    // deep-equal against an equally broken fixture. Pin the shape.
    for (const zone of parsed) {
      expect(typeof zone.name).toBe('string');
      expect(zone.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(zone.lat)).toBe(true);
      expect(Number.isFinite(zone.lng)).toBe(true);
      expect(zone.radiusKm).toBeGreaterThan(0);
    }
  });
});
