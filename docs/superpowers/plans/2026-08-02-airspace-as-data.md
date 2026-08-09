# Airspace as Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two hardcoded no-fly circles with DB-backed airspace zones carrying altitude bounds, time windows, and an audited admin CRUD surface.

**Architecture:** A new non-partitioned `airspace_zones` table, seeded in its migration with the two zones the constant currently holds. A new `AirspaceService` owns the in-force query and a short-TTL cache, and **fails closed** — the inverse of `WeatherService`. `ServiceabilityService` keeps all of its existing geometry and swaps only the source of the zone list. Four ADMIN routes manage zones, each mutation writing a co-committed audit row through the increment-4 machinery.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL 16), Jest with a mocked Prisma client (`src/test/prisma-mock.ts`), class-validator DTOs.

**Spec:** `docs/superpowers/specs/2026-08-02-airspace-as-data-design.md`

## Global Constraints

- **Read the spec first.** Its decisions are settled; do not re-litigate them.
- **TDD is mandatory.** Write the failing test, RUN it, watch it fail for the right reason, then implement. Every review in this project's last increment enforced this, and several found tests that passed against a broken implementation.
- **Airspace fails CLOSED.** If the zone query throws, `checkServiceability` returns blocked with `NO_FLY_ZONE`. This is the deliberate inverse of `WeatherService`, which fails open. Comment it at the catch site, or someone will later "fix" it into consistency.
- **A failed query must never populate the cache.** Caching an empty set on failure turns one bad query into a TTL-long window of open airspace. Same rule, easiest place to get it wrong.
- **Never run `npm run lint`** — it passes `--fix` and rewrites files. Use `npx eslint "{src,apps,libs,test}/**/*.ts"`.
- **Lint baseline is exactly `98 problems (0 errors, 98 warnings)`.** Prettier violations are lint ERRORS.
- **`npx tsc -p tsconfig.build.json --noEmit` must be clean.** `npx tsc -p tsconfig.json --noEmit` has exactly ONE pre-existing error (`src/deliveries/deliveries.controller.spec.ts:120`) — leave it, and do not let it become two. Watch for `jest.fn(() => {})`, whose zero-arg call tuple has broken this before.
- **Test baseline: 982 tests, 88 suites, all green.**
- **`prisma db push` / `db pull` are forbidden.** `npm run prisma:drift-check` must report "No difference detected".
- **The DB URL is in `.env`, not the shell.** Prefix DB commands: `set -a; . ./.env; set +a; <command>`
- **`npx jest` is slow on this machine** (background CPU contention from other projects). Use `npx jest --maxWorkers=4`.
- **`jest -t` takes a REGEX.** A test name containing `list()` or other metacharacters will silently match nothing, run zero tests, and exit 0 — which a naive script reads as a pass. When mutation-testing, run whole spec files, and treat "0 tests ran" as a failure of the harness.
- **Do NOT modify** `package.json`, `tsconfig*.json`, or jest config.
- **Commit after every task**, with a body explaining *why*. Match the existing log's voice (`git log --oneline -20`).

---

### Task 1: The table, seeded

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_airspace_zones/migration.sql`
- Modify: `src/test/prisma-mock.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `AirspaceZone` (fields below); enum `AirspaceZoneKind` = `AIRPORT | MILITARY | TEMPORARY | EVENT`; three new `AdminAuditAction` values `AIRSPACE_ZONE_CREATE`, `AIRSPACE_ZONE_UPDATE`, `AIRSPACE_ZONE_DEACTIVATE`; one new `AdminAuditTargetType` value `AIRSPACE_ZONE`; `prisma.airspaceZone` on the test mock.

- [ ] **Step 1: Add the enums and model to `prisma/schema.prisma`**

Place `AirspaceZoneKind` next to the model, matching the file's convention of enums adjacent to their model.

**Both audit enums are extended here, in this one migration** — the three `AdminAuditAction` values AND the `AIRSPACE_ZONE` value on `AdminAuditTargetType`. Task 4 uses them; splitting the target type into its own later migration would mean two `ALTER TYPE` migrations for one feature and would leave Task 4's tests unable to reference the value they assert on.

```prisma
enum AirspaceZoneKind {
  AIRPORT
  MILITARY
  TEMPORARY
  EVENT
}

/// Restricted airspace, as data rather than a module constant.
///
/// NOT partitioned, unlike the other tables added in this phase: this is a small
/// operator-maintained registry read on every quote, not an append-only log. It wants
/// a plain single-column PK so `findUnique`/`update` by id work normally.
model AirspaceZone {
  id       String           @id @default(uuid())
  name     String           @db.VarChar(120)
  kind     AirspaceZoneKind
  lat      Float
  lng      Float
  radiusKm Float

  /// Vertical extent. Null floor = surface; null ceiling = unlimited.
  ///
  /// Stored and surfaced, but it does NOT relax a planning block: a quote has no
  /// altitude, so any zone the route touches horizontally blocks regardless of these.
  /// They exist so an in-flight breach can be detected against recorded frame altitude
  /// (the flight recorder has carried altitude since increment 1).
  floorM   Int?
  ceilingM Int?

  /// Null = unbounded on that side. A zone is IN FORCE when `active` is true AND now
  /// falls inside the window.
  activeFrom  DateTime?
  activeUntil DateTime?

  /// Operator kill-switch, deliberately independent of the window: a zone can be
  /// disabled now without editing its dates, and a future TFR can be staged without
  /// being live. Deactivation is also how a zone is "deleted" — the row is kept,
  /// because a zone that once existed is part of why a past delivery was refused.
  active Boolean @default(true)

  notes String? @db.VarChar(500)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active])
  @@map("airspace_zones")
}
```

- [ ] **Step 2: Generate the migration scaffold**

```bash
set -a; . ./.env; set +a
npx prisma migrate dev --create-only --name add_airspace_zones
```

- [ ] **Step 3: Append the seed to the generated migration**

Prisma's generated SQL is correct for this table (it is not partitioned, so there is nothing to hand-write). Keep what it generated and APPEND the seed below.

```sql
-- Seed the two zones that until now lived in serviceability.constants.ts.
--
-- This is load-bearing. Task 3 deletes that constant, and without these rows the
-- geometry would simply find no zones — the airspace this system protects would open
-- silently, with every test still green. Coordinates and radii are copied verbatim.
INSERT INTO "airspace_zones" ("id", "name", "kind", "lat", "lng", "radiusKm", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Soekarno-Hatta International Airport', 'AIRPORT', -6.1256, 106.6558, 5, true, NOW(), NOW()),
  (gen_random_uuid(), 'Halim Perdanakusuma Airport',          'AIRPORT', -6.2647, 106.9308, 3, true, NOW(), NOW());
```

**Postgres note, and check this holds in the generated file:** `ALTER TYPE … ADD VALUE` may not have its new value *used* later in the same transaction, and Prisma wraps each migration file in one. The three `AdminAuditAction` values are added here and first used in Task 4, a different migration-free code change — fine. `AirspaceZoneKind` is different: a type CREATED in the same transaction is exempt from that restriction, so the seed's `'AIRPORT'` literal is legal. Do not add a statement that writes an `admin_audit_logs` row using the new action values in this file.

- [ ] **Step 4: Apply and verify**

```bash
set -a; . ./.env; set +a
npx prisma migrate dev
npm run prisma:drift-check
U="${DATABASE_URL%%\?*}"
psql "$U" -At -c "SELECT name, kind, \"radiusKm\", active FROM airspace_zones ORDER BY name;"
psql "$U" -At -c "SELECT unnest(enum_range(NULL::\"AdminAuditAction\"));" | grep AIRSPACE
```

Expected: drift-check "No difference detected"; two AIRPORT rows with radii 5 and 3; three `AIRSPACE_ZONE_*` values present.

- [ ] **Step 5: Add the mock delegate**

In `src/test/prisma-mock.ts`, add `| 'airspaceZone'` to the model-name union and `airspaceZone: createModelMock(),` to the object literal, exactly as `adminAuditLog` was added.

- [ ] **Step 6: Verify nothing broke**

```bash
npx jest --maxWorkers=4 2>&1 | tail -4
npx tsc -p tsconfig.build.json --noEmit && echo clean
```

Expected: 982 tests still green (no behaviour has changed yet), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add prisma/ src/test/prisma-mock.ts
git commit -m "feat(airspace): airspace_zones, seeded with the two zones the constant held

Not partitioned, unlike the other tables this phase added: a small
operator-maintained registry read on every quote, not an append-only log.

The seed is load-bearing. A later task deletes NO_FLY_ZONES, and without these
rows the geometry would find no zones — the airspace this system protects would
open silently, with every test still green."
```

---

### Task 2: `AirspaceService` — the in-force query, cached, fail-closed

**Files:**
- Create: `src/serviceability/airspace.service.ts`
- Create: `src/serviceability/airspace.constants.ts`
- Create: `src/serviceability/airspace.service.spec.ts`
- Modify: `src/serviceability/serviceability.module.ts`

**Interfaces:**
- Consumes: `prisma.airspaceZone` (Task 1).
- Produces:
  - `AIRSPACE_CACHE_TTL_MS: number` (default 30_000, env-overridable)
  - `AirspaceService.inForceZones(now?: Date): Promise<GeoCircle[]>` — returns zones in force, THROWS on query failure (the caller decides what that means)
  - `AirspaceService.invalidate(): void`

- [ ] **Step 1: Write the failing tests**

Create `src/serviceability/airspace.service.spec.ts`:

```typescript
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
      { name: 'Soekarno-Hatta International Airport', lat: -6.1256, lng: 106.6558, radiusKm: 5 },
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

  it('caches within the TTL, then refreshes', async () => {
    await service.inForceZones(new Date('2026-08-02T00:00:00Z'));
    await service.inForceZones(new Date('2026-08-02T00:00:10Z'));
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(1);

    await service.inForceZones(new Date('2026-08-02T00:01:00Z'));
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
    prisma.airspaceZone.findMany.mockRejectedValue(new Error('connection reset'));

    await expect(service.inForceZones()).rejects.toThrow('connection reset');
  });

  it('does not cache a failure', async () => {
    // Otherwise one bad query opens the airspace for a whole TTL.
    prisma.airspaceZone.findMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.inForceZones(new Date('2026-08-02T00:00:00Z'))).rejects.toThrow();
    await expect(
      service.inForceZones(new Date('2026-08-02T00:00:01Z')),
    ).resolves.toHaveLength(1);
    expect(prisma.airspaceZone.findMany).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest src/serviceability/airspace.service.spec.ts --maxWorkers=4
```

Expected: FAIL — `Cannot find module './airspace.service'`.

- [ ] **Step 3: Write `airspace.constants.ts`**

```typescript
/**
 * How long an in-force zone list may be served from memory.
 *
 * Serviceability runs on every quote, and this replaced a module constant, so an
 * uncached read would add a DB round trip to a hot path. 30s is chosen so the worst
 * case is small and STATED rather than because the load demands it: writes invalidate
 * immediately on the instance that made them, and this bounds staleness everywhere
 * else. An operator adding an emergency restriction should see it take effect in
 * seconds across the fleet.
 */
export const AIRSPACE_CACHE_TTL_MS =
  Number(process.env.AIRSPACE_CACHE_TTL_MS) || 30_000;
```

- [ ] **Step 4: Write `airspace.service.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AIRSPACE_CACHE_TTL_MS } from './airspace.constants';
import { GeoCircle } from './serviceability.types';

/**
 * Restricted airspace, read from the database.
 *
 * This service deliberately does NOT decide what a failure means — it throws, and
 * `ServiceabilityService` turns that into a hard block. Keeping the policy at the
 * caller is what makes the fail-closed decision visible next to the fail-OPEN weather
 * check it deliberately contradicts.
 */
@Injectable()
export class AirspaceService {
  private readonly logger = new Logger(AirspaceService.name);
  private cache: { at: number; zones: GeoCircle[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Zones in force at `now`: switched on AND inside their time window.
   *
   * Throws if the query fails. A caller that swallows this and proceeds has decided
   * there is no restricted airspace, which is never a safe default.
   */
  async inForceZones(now: Date = new Date()): Promise<GeoCircle[]> {
    const at = now.getTime();
    if (this.cache && at - this.cache.at < AIRSPACE_CACHE_TTL_MS) {
      return this.cache.zones;
    }

    // `active` is the indexed kill-switch; the window is applied on top. Filtering the
    // window in SQL too would push a NOW() comparison into a query whose result is then
    // cached for 30s, so the precision would be false.
    const rows = await this.prisma.airspaceZone.findMany({
      where: { active: true },
      select: {
        name: true,
        lat: true,
        lng: true,
        radiusKm: true,
        activeFrom: true,
        activeUntil: true,
      },
    });

    const zones = rows
      .filter(
        (z) =>
          (z.activeFrom === null || z.activeFrom.getTime() <= at) &&
          (z.activeUntil === null || z.activeUntil.getTime() >= at),
      )
      .map(({ name, lat, lng, radiusKm }) => ({ name, lat, lng, radiusKm }));

    // Only reached when the query resolved — a throw above leaves the previous cache
    // (or none) untouched, so a failure can never masquerade as empty airspace.
    this.cache = { at, zones };
    return zones;
  }

  /** Drop the cache so the next read is authoritative. Called on every zone write. */
  invalidate(): void {
    this.cache = null;
  }
}
```

- [ ] **Step 5: Register it**

In `src/serviceability/serviceability.module.ts`, add `AirspaceService` to `providers` and `exports`. `PrismaModule` is `@Global`, so no import is needed and the module stays a leaf — preserve that comment's accuracy by extending it rather than leaving it stale.

- [ ] **Step 6: Run the tests**

```bash
npx jest src/serviceability --maxWorkers=4
npx tsc -p tsconfig.build.json --noEmit && echo clean
```

- [ ] **Step 7: Commit**

```bash
git add src/serviceability/
git commit -m "feat(airspace): read zones from the database, cached, failing closed

The service throws on a query failure rather than returning an empty list, and the
caller turns that into a hard block. Keeping the policy at the caller is what makes
the fail-closed decision visible next to the fail-OPEN weather check it contradicts.

A failed query also never populates the cache — otherwise one bad read would report
open airspace for a whole TTL."
```

---

### Task 3: Swap the source, delete the constant

**Files:**
- Modify: `src/serviceability/serviceability.service.ts`
- Modify: `src/serviceability/serviceability.constants.ts` (delete `NO_FLY_ZONES`)
- Modify: `src/serviceability/serviceability.service.spec.ts`
- Test: any spec constructing `ServiceabilityService` (it gains a constructor argument)

**Interfaces:**
- Consumes: `AirspaceService.inForceZones()` (Task 2).
- Produces: `ServiceabilityService` constructor becomes `(weather: WeatherService, airspace: AirspaceService)`.

**The regression that matters:** behaviour must be IDENTICAL for the two seeded zones. The existing serviceability tests are the guard — make them pass against DB-backed lookup rather than rewriting them to suit the new shape.

- [ ] **Step 1: Write the failing tests**

Add to `src/serviceability/serviceability.service.spec.ts`:

```typescript
it('blocks on a zone that came from the database', async () => {
  airspace.inForceZones.mockResolvedValue([
    { name: 'Test TFR', lat: -6.9125, lng: 107.611, radiusKm: 5 },
  ]);

  const result = await service.checkServiceability(-6.9125, 107.611, -6.92, 107.62);

  expect(result.serviceable).toBe(false);
  expect(result.codes).toContain('NO_FLY_ZONE');
  expect(result.params).toMatchObject({ zoneName: 'Test TFR' });
});

it('blocks when the airspace lookup FAILS — the inverse of weather', async () => {
  // WeatherService fails open on purpose: an unreachable forecast must not ground the
  // fleet. Airspace is the opposite — a DB blip must never read as "no restricted
  // airspace", because the consequence is a drone inside it.
  airspace.inForceZones.mockRejectedValue(new Error('connection reset'));

  const result = await service.checkServiceability(-6.9125, 107.611, -6.92, 107.62);

  expect(result.serviceable).toBe(false);
  expect(result.codes).toContain('NO_FLY_ZONE');
});

it('does not consult the weather API once airspace has blocked', async () => {
  // The no-fly check short-circuits, as it did when zones were a constant.
  airspace.inForceZones.mockRejectedValue(new Error('connection reset'));

  await service.checkServiceability(-6.9125, 107.611, -6.92, 107.62);

  expect(weather.getConditions).not.toHaveBeenCalled();
});
```

Update the spec's setup to provide the new dependency:

```typescript
let airspace: { inForceZones: jest.Mock };
// in beforeEach, before constructing the service:
airspace = { inForceZones: jest.fn().mockResolvedValue([]) };
service = new ServiceabilityService(weather as never, airspace as never);
```

Then, for the EXISTING no-fly tests that relied on the hardcoded zones, make `airspace.inForceZones` resolve the two seeded zones so those tests keep asserting exactly what they asserted before. Do not weaken them.

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest src/serviceability --maxWorkers=4
```

Expected: FAIL — `ServiceabilityService` takes one constructor argument, and `NO_FLY_ZONE` is not produced from a DB-sourced list.

- [ ] **Step 3: Wire the service in**

In `serviceability.service.ts`: inject `AirspaceService`; make `zoneContaining`/`zoneOnRoute` take the zone list as a parameter instead of reading the constant; and replace the no-fly block with:

```typescript
    // --- HARD: no-fly zones (endpoints + route). Short-circuit. ---
    //
    // FAIL CLOSED, deliberately opposite to the weather check below. Weather is
    // advisory and fails open: an unreachable forecast must not ground the fleet.
    // Airspace is not advisory. If we cannot read the zone list we do not know
    // whether this route crosses restricted airspace, and the only safe answer to
    // "I don't know" is no. Do not "fix" this into consistency with weather.
    let zones: GeoCircle[];
    try {
      zones = await this.airspace.inForceZones();
    } catch (error) {
      this.logger.error(
        `Airspace lookup failed — blocking the route: ${(error as Error).message}`,
      );
      return this.blocked(
        'NO_FLY_ZONE',
        'Restricted airspace could not be verified for this route.',
        { zoneName: 'unverified airspace' },
      );
    }

    const zone =
      this.zoneContaining(fromLat, fromLng, zones) ??
      this.zoneContaining(toLat, toLng, zones) ??
      this.zoneOnRoute({ fromLat, fromLng, toLat, toLng }, zones);
    if (zone) {
      return this.blocked(
        'NO_FLY_ZONE',
        `Route is restricted near ${zone.name} (no-fly zone).`,
        { zoneName: zone.name },
      );
    }
```

Leave `inCircle`, `routeNearCircle`, `project` and `pointToSegmentKm` exactly as they are — the geometry is tested and correct, and this task changes only where the circles come from.

- [ ] **Step 4: Delete `NO_FLY_ZONES`**

Remove the constant and the now-unused `NoFlyZone` import from `serviceability.constants.ts`. Keep `SERVICE_AREAS`, `MAX_WIND_KPH`, `DEFAULT_MAX_ROUTE_KM` and `maxRouteKm`. Keep the `NoFlyZone` type export in `serviceability.types.ts` if anything still references it; remove it if not.

Update the file's header comment: it currently explains why the Jakarta airports are safe for the Bandung demo. That rationale now lives with the seed data, so point at it rather than deleting the reasoning.

- [ ] **Step 5: Fix every other construction site**

`grep -rn "new ServiceabilityService" src --include=*.ts` and update each. Some specs build it directly; the DI container handles the rest.

- [ ] **Step 6: Run the full suite**

```bash
npx jest --maxWorkers=4 2>&1 | tail -4
npx tsc -p tsconfig.build.json --noEmit && echo clean
npx eslint "{src,apps,libs,test}/**/*.ts" 2>&1 | tail -2
```

Expected: all green, typecheck clean, lint at exactly the baseline.

- [ ] **Step 7: Prove the seeded zones still block, against the real database**

This is the one check the unit tests cannot make — they mock the query that the seed populates.

```bash
set -a; . ./.env; set +a; U="${DATABASE_URL%%\?*}"
psql "$U" -At -c "SELECT name, \"radiusKm\" FROM airspace_zones WHERE active ORDER BY name;"
```

Expected: the two AIRPORT rows. Record the output in your report — the seed is what makes deleting the constant safe.

- [ ] **Step 8: Commit**

```bash
git add src/serviceability/
git commit -m "feat(airspace): source no-fly zones from the database, and block on failure

The geometry is unchanged — only where the circles come from. The existing no-fly
tests still assert exactly what they asserted before, now against DB-sourced zones.

The catch is the point of this commit: a failed lookup returns NO_FLY_ZONE rather
than proceeding. Weather fails open by design, and it would be an easy and very bad
consistency fix to make airspace match it."
```

---

### Task 4: Audited admin CRUD

**Files:**
- Create: `src/admin/dto/airspace.dto.ts`
- Modify: `src/admin/admin.service.ts`
- Modify: `src/admin/admin.controller.ts`
- Modify: `src/admin/audit/admin-audit.constants.ts`
- Modify: `src/admin/admin.module.ts` (import `ServiceabilityModule` for `AirspaceService`)
- Test: `src/admin/admin.service.spec.ts`, `src/admin/admin.controller.spec.ts`

**Interfaces:**
- Consumes: `AirspaceService.invalidate()`; `AdminAuditService.recordWithinTx`; `pickAllowed`/`diffAllowed`; `@AuditActor()`.
- Produces: `AdminService.listAirspaceZones()`, `createAirspaceZone(actor, dto)`, `updateAirspaceZone(actor, id, dto)`, `deactivateAirspaceZone(actor, id)`.

**Follow the shape the last increment settled on** — read `createDrone`/`updateDrone` in `admin.service.ts` before writing anything, and copy it:
- payload sourced from the CREATED/UPDATED ROW, never the DTO;
- everything through `pickAllowed`/`diffAllowed`;
- the audit write co-committed inside the same `$transaction`;
- the guard that makes a mutation fail (404) placed BEFORE the audit call;
- `@AuditActor()` on the route, never a `@CurrentUser` pair.

- [ ] **Step 1: Extend the audit allowlist**

In `src/admin/audit/admin-audit.constants.ts`:

```typescript
  AIRSPACE_ZONE_CREATE: [
    'name',
    'kind',
    'lat',
    'lng',
    'radiusKm',
    'floorM',
    'ceilingM',
    'activeFrom',
    'activeUntil',
  ],
  AIRSPACE_ZONE_UPDATE: [
    'name',
    'kind',
    'lat',
    'lng',
    'radiusKm',
    'floorM',
    'ceilingM',
    'activeFrom',
    'activeUntil',
    'active',
  ],
  AIRSPACE_ZONE_DEACTIVATE: ['active'],
```

`notes` is deliberately excluded — free text, same reasoning as `description` on promos.

- [ ] **Step 2: Write the DTOs**

`src/admin/dto/airspace.dto.ts`, following `CreateDroneDto`'s validator style:

```typescript
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AirspaceZoneKind } from '@prisma/client';

/** A zone bigger than this is almost certainly a units error, and would ground a region. */
export const MAX_ZONE_RADIUS_KM = 500;

export class CreateAirspaceZoneDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;

  @IsEnum(AirspaceZoneKind) kind: AirspaceZoneKind;

  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;

  @IsNumber() @IsPositive() @Max(MAX_ZONE_RADIUS_KM) radiusKm: number;

  @IsOptional() @IsInt() @Min(0) floorM?: number;
  @IsOptional() @IsInt() @Min(0) ceilingM?: number;

  @IsOptional() @IsDateString() activeFrom?: string;
  @IsOptional() @IsDateString() activeUntil?: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateAirspaceZoneDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(AirspaceZoneKind) kind?: AirspaceZoneKind;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsNumber() @IsPositive() @Max(MAX_ZONE_RADIUS_KM) radiusKm?: number;
  @IsOptional() @IsInt() @Min(0) floorM?: number;
  @IsOptional() @IsInt() @Min(0) ceilingM?: number;
  @IsOptional() @IsDateString() activeFrom?: string;
  @IsOptional() @IsDateString() activeUntil?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
```

- [ ] **Step 3: Write the failing tests**

Add to `src/admin/admin.service.spec.ts`. Note the two ordering-relative-to-guard tests — that defect class has been found four times in this phase.

```typescript
describe('airspace zones', () => {
  const ACTOR = { userId: 'admin-1', role: 'ADMIN' as const };

  it('rejects a window that closes before it opens', async () => {
    // Unlike the audit-log query's inverted range, which returns an empty 200, this
    // one is a 400: it silently creates a zone that is never in force, which on an
    // airspace surface reads as protection that does not exist.
    await expect(
      service.createAirspaceZone(ACTOR, {
        name: 'Bad TFR',
        kind: 'TEMPORARY',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 2,
        activeFrom: '2026-09-02T00:00:00Z',
        activeUntil: '2026-09-01T00:00:00Z',
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.airspaceZone.create).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a floor above its ceiling', async () => {
    await expect(
      service.createAirspaceZone(ACTOR, {
        name: 'Inverted',
        kind: 'EVENT',
        lat: -6.9,
        lng: 107.6,
        radiusKm: 2,
        floorM: 500,
        ceilingM: 100,
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.airspaceZone.create).not.toHaveBeenCalled();
  });

  it('records a created zone from the stored row and invalidates the cache', async () => {
    prisma.airspaceZone.create.mockResolvedValue({
      id: 'z-9',
      name: 'Bandung Air Show',
      kind: 'EVENT',
      lat: -6.9,
      lng: 107.6,
      radiusKm: 3,
      floorM: null,
      ceilingM: null,
      activeFrom: null,
      activeUntil: null,
      active: true,
    });

    await service.createAirspaceZone(ACTOR, {
      name: 'Bandung Air Show',
      kind: 'EVENT',
      lat: -6.9,
      lng: 107.6,
      radiusKm: 3,
    } as never);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AIRSPACE_ZONE_CREATE',
        targetType: 'AIRSPACE_ZONE',
        targetId: 'z-9',
        args: expect.objectContaining({ name: 'Bandung Air Show', radiusKm: 3 }),
      }),
    });
    // A new restriction that is not live until a TTL expires is a restriction that
    // is not enforced.
    expect(airspace.invalidate).toHaveBeenCalled();
  });

  it('deactivates rather than deleting', async () => {
    prisma.airspaceZone.findUnique.mockResolvedValue({ id: 'z-9', active: true });
    prisma.airspaceZone.update.mockResolvedValue({ id: 'z-9', active: false });

    await service.deactivateAirspaceZone(ACTOR, 'z-9');

    // A zone that once existed is part of why a past delivery was refused.
    expect(prisma.airspaceZone.delete).not.toHaveBeenCalled();
    expect(prisma.airspaceZone.update.mock.calls[0][0].data).toMatchObject({
      active: false,
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AIRSPACE_ZONE_DEACTIVATE',
        before: { active: true },
        after: { active: false },
      }),
    });
  });

  it('writes no audit row when the zone does not exist', async () => {
    prisma.airspaceZone.findUnique.mockResolvedValue(null);

    await expect(
      service.updateAirspaceZone(ACTOR, 'missing', { radiusKm: 4 } as never),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('runs the audit write inside the SAME transaction as the zone create', async () => {
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async (fn: any) => {
      order.push('begin');
      const r = await fn(prisma.txClient);
      order.push('commit');
      return r;
    });
    prisma.airspaceZone.create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: 'z-9', name: 'X', kind: 'EVENT', lat: 0, lng: 0, radiusKm: 1, active: true });
    });
    prisma.adminAuditLog.create.mockImplementation(() => {
      order.push('audit');
      return Promise.resolve({});
    });

    await service.createAirspaceZone(ACTOR, {
      name: 'X', kind: 'EVENT', lat: 0, lng: 0, radiusKm: 1,
    } as never);

    expect(order).toEqual(['begin', 'create', 'audit', 'commit']);
  });
});
```

Add `airspace = { invalidate: jest.fn(), inForceZones: jest.fn() }` to the spec's providers.

- [ ] **Step 4: Run and watch them fail**

```bash
npx jest src/admin/admin.service.spec.ts --maxWorkers=4
```

Expected: FAIL — the four methods do not exist.

- [ ] **Step 5: Implement the four service methods**

Validation (`activeFrom < activeUntil`, `floorM < ceilingM`) lives in a private helper called by both create and update, throwing `AppBadRequestException`. Add the two i18n keys it needs to `src/i18n/catalog/en.ts`, `id.ts` and `keys.ts` — the catalog has a completeness test that will fail otherwise.

Each mutation: validate → (for update/deactivate) read the row for `before` and its 404 → `$transaction` wrapping the write plus `recordWithinTx` → **`this.airspace.invalidate()` after the transaction commits**, not inside it. Invalidating inside would drop the cache for a write that then rolls back, which is merely wasteful — but invalidating before the commit is also racy, so put it after and say why.

`AIRSPACE_ZONE` already exists on `AdminAuditTargetType` — Task 1 added it in the same migration as the three action values. No migration is needed in this task.

- [ ] **Step 6: Add the four routes**

In `admin.controller.ts`, following the fleet block's shape and using `@AuditActor()`:

```typescript
  // ── Airspace ──
  @Get('airspace')
  listAirspace() {
    return this.admin.listAirspaceZones();
  }

  @Post('airspace')
  createAirspace(@AuditActor() actor: AuditActor, @Body() dto: CreateAirspaceZoneDto) {
    return this.admin.createAirspaceZone(actor, dto);
  }

  @Patch('airspace/:id')
  updateAirspace(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: UpdateAirspaceZoneDto,
  ) {
    return this.admin.updateAirspaceZone(actor, id, dto);
  }

  @Delete('airspace/:id')
  deactivateAirspace(@AuditActor() actor: AuditActor, @Param('id') id: string) {
    return this.admin.deactivateAirspaceZone(actor, id);
  }
```

Check `@Delete` is imported from `@nestjs/common` — the controller may not use it yet.

Extend `admin.controller.spec.ts` with forwarding tests for the four routes, matching the existing block.

- [ ] **Step 7: Verify**

```bash
npx jest --maxWorkers=4 2>&1 | tail -4
npx tsc -p tsconfig.build.json --noEmit && echo clean
npx eslint "{src,apps,libs,test}/**/*.ts" 2>&1 | tail -2
set -a; . ./.env; set +a; npm run prisma:drift-check
```

- [ ] **Step 8: Commit**

```bash
git add src/admin/ src/i18n/ prisma/
git commit -m "feat(airspace): audited admin CRUD for zones

A no-fly zone that needs a deploy is not data. Four ADMIN routes, each mutation
co-committing an audit row through the increment-4 machinery — the first new consumer
of it, and a real test of whether it generalises.

Delete is a deactivation. A zone that once existed is part of the record of why a
delivery was refused, and hard-deleting it makes a past refusal unexplainable.

An inverted time window is a 400 rather than an empty result, unlike the audit-log
query: a zone that is never in force reads as protection that does not exist."
```

---

### Task 5: Docs, verification, and the log entry

**Files:**
- Modify: `.env.example`
- Modify: `AUDIT-LOG.md`, `AUDIT-PLAN.md`
- Create: a mutation script in the SDD workspace (NOT in the repo)

- [ ] **Step 1: Document `AIRSPACE_CACHE_TTL_MS` in `.env.example`**

Place it near the serviceability/weather block. State what the bound means: writes invalidate immediately on the writing instance, and this caps staleness on every other replica.

- [ ] **Step 2: Full verification sweep, recording REAL numbers**

```bash
npx jest --maxWorkers=4 2>&1 | tail -5
npx tsc -p tsconfig.build.json --noEmit && echo "tsc clean"
npx tsc -p tsconfig.json --noEmit 2>&1 | wc -l   # expect 1
npx eslint "{src,apps,libs,test}/**/*.ts" 2>&1 | tail -2
set -a; . ./.env; set +a; npm run prisma:drift-check
U="${DATABASE_URL%%\?*}"; psql "$U" -At -c "SELECT name, kind, \"radiusKm\" FROM airspace_zones ORDER BY name;"
```

- [ ] **Step 3: Mutation testing**

Write ONE script in the workspace directory. Every mutation must COMPILE first — one caught by the typechecker proves nothing. Run whole spec files, never `jest -t` (it takes a regex; a name with `()` in it silently matches nothing and exits 0). Treat a run with zero tests as a harness failure, not a pass.

At minimum:
1. `inForceZones` returns `[]` instead of throwing on a query failure — the fail-open inversion.
2. The catch in `checkServiceability` proceeds instead of returning blocked.
3. A failed query populates the cache.
4. The time-window filter drops its `activeFrom` half.
5. The time-window filter drops its `activeUntil` half.
6. `where: { active: true }` becomes `where: {}` (disabled zones become live).
7. `invalidate()` is not called after a zone write.
8. The create audit write is hoisted out of its transaction.
9. The create audit write is handed `this.prisma` instead of the transaction client.
10. Deactivate calls `delete` instead of `update`.
11. The inverted-window validation is skipped.
12. `zoneOnRoute` is dropped from the check chain (endpoint-only no-fly).

Report the tally and any survivor. **If a mutation survives, that is a finding — report it rather than quietly adding a test to cover it.**

- [ ] **Step 4: Write the `AUDIT-LOG.md` entry**

Match the existing entries' structure exactly: `What changed`, `Verification` (fenced, real numbers), `Decisions made`, `Deviations from the plan`, `Left undone / follow-ups`, `Next`.

Be precise about what shipped, because this file has a documented history of confident claims that were larger than reality — including, in the last increment, a correction commit that introduced three new miscounts of its own. Specifically:
- State that altitude is **stored and audited but does not gate planning**, and why (a quote has no altitude). Do not imply altitude enforcement.
- State that the time window is evaluated at **quote time and again at pre-flight**, and that the pre-flight evaluation is the authoritative one for a scheduled delivery.
- Under follow-ups: in-flight breach detection against `floorM`/`ceilingM` (the flight recorder already has the altitude); polygons; NOTAM/AIP import; no admin UI (12.5).
- Note the cache's staleness bound explicitly.

- [ ] **Step 5: Update `AUDIT-PLAN.md` §2's Phase 12 row**

- [ ] **Step 6: Commit and STOP — do not merge**

```bash
git add -A
git commit -m "docs(audit): log phase 12 increment 5 (airspace as data)"
```

---

## Self-review notes

- **Spec coverage:** model → Task 1; altitude stored-not-enforced → Tasks 1 (schema comment) and 5 (log entry); time windows → Task 2; fail-closed → Tasks 2 and 3; cache + invalidation → Tasks 2 and 4; admin CRUD → Task 4; seeding → Task 1; validation → Task 4; testing → each task plus Task 5's mutation set.
- **Naming consistency:** `AirspaceService`, `inForceZones`, `invalidate`, `AIRSPACE_CACHE_TTL_MS`, `AirspaceZoneKind`, `AIRSPACE_ZONE_{CREATE,UPDATE,DEACTIVATE}`, `AIRSPACE_ZONE` target type — used identically throughout.
- **Sequencing:** Task 1 before all (schema + mock). Task 2 before Task 3 (the service the swap consumes). Task 3 before Task 4 only loosely — Task 4 needs `AirspaceService.invalidate`, which Task 2 provides.
- **Known risk:** Task 3 changes a constructor signature used by several specs. The step to grep every construction site exists because missing one is a compile error, not a silent failure — but it will look like unrelated breakage to whoever hits it.
