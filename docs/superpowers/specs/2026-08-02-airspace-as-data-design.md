# Airspace as data — design

**Date:** 2026-08-02
**Phase:** 12, increment 5 (plan item 12.4)
**Repo:** backend only

## Problem

Restricted airspace is two hardcoded circles in a module constant
(`src/serviceability/serviceability.constants.ts:14-27`) — Soekarno-Hatta and Halim — with:

- **no altitude dimension.** A no-fly zone is a 2D disc: infinitely tall, surface to space.
- **no time dimension.** A temporary flight restriction for an event or an incident cannot be
  expressed at all.
- **no way to change it without a deploy.** An emergency TFR requires a code change, review,
  build and release.

Meanwhile increment 1 added altitude to the flight recorder, and increment 2 moved the
serviceability check to immediately before rotor spin-up — so the two things that would make
a richer airspace model useful are already in place.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Geometry | **Circles**, not polygons | The existing `inCircle` / `routeNearCircle` geometry is tested and correct. Polygon containment plus segment-polygon intersection is a materially larger problem, and nothing in the audit asks for it. A circle set approximates a real TFR adequately. |
| Altitude | Modelled now, **enforced in planning only as a conservative block**; in-flight detection deferred | A quote has no altitude — see below. |
| Failure mode | **Fail CLOSED** | The inverse of weather, deliberately. |
| Caching | Short TTL + explicit invalidation on write | Serviceability runs on every quote; a DB read per call is a real change from a module constant. |
| Admin surface | **Full CRUD**, audited | A no-fly zone that needs a deploy is not data. |
| Seeding | The two existing zones become rows **in the migration** | Deleting the constant without seeding silently opens the airspace this system currently protects. |

## Data model

New model `AirspaceZone`, `@@map("airspace_zones")`. **Not partitioned** — it is a small
operator-maintained registry, not an append-only log, and it is read on every quote.

```
id          String   @id @default(uuid())
name        String
kind        AirspaceZoneKind        -- AIRPORT | MILITARY | TEMPORARY | EVENT
lat         Float
lng         Float
radiusKm    Float
floorM      Int?                    -- null = surface
ceilingM    Int?                    -- null = unlimited
activeFrom  DateTime?               -- null = always (permanent)
activeUntil DateTime?               -- null = never expires
active      Boolean  @default(true) -- operator kill-switch, independent of the window
notes       String?  @db.VarChar(500)
createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt

@@index([active])
```

`active` is deliberately separate from the time window. An operator needs to disable a zone
*now* without editing its dates, and needs to pre-stage a future TFR without it being live.

### The altitude honesty problem

A quote has no altitude. The route is a 2D line and nothing decides a cruise altitude before
launch. So **altitude cannot gate planning**, and pretending otherwise would be the
overstatement pattern this phase keeps tripping on.

What altitude buys, split honestly:

- **Planning (quote + pre-flight):** any *active* zone whose horizontal extent the route
  touches blocks, regardless of `floorM`/`ceilingM`. Identical to today's behaviour for
  surface-to-unlimited zones, and conservative for the rest.
- **In flight:** the flight recorder has recorded altitude since increment 1, so a breach
  becomes *detectable* — a drone at 400 m over a zone ceilinged at 150 m.

This increment builds the model and the planning half. The in-flight breach detector is
recorded as a follow-up, not half-built.

### Time-window semantics

A zone is **in force** when `active` is true AND `now` is within `[activeFrom, activeUntil]`
(each bound null = unbounded).

Evaluated against **now**, at both quote and pre-flight. For a delivery scheduled 60 days out
that means the quote answers "is this zone in force today", which is the wrong question — and
is precisely why increment 2 exists. The pre-flight re-check immediately before launch is the
authoritative one, and it evaluates the window at launch time. That asymmetry is already the
established design; this increment does not change it.

## Fail closed — the inversion that matters

`WeatherService` fails **open**: an unreachable weather API must not ground the fleet, and the
code says so explicitly.

Airspace is the opposite. If the zone query throws, `checkServiceability` returns blocked with
`NO_FLY_ZONE`. A DB blip that flies a drone through restricted airspace is not a trade anyone
would take, and the asymmetry with weather must be commented at the catch site or someone will
"fix" it into consistency later.

## Caching

`AirspaceService` holds an in-memory cache of in-force zones with a short TTL
(`AIRSPACE_CACHE_TTL_MS`, default 30s), refreshed on read when stale and **invalidated
explicitly on every write** through the admin surface.

The bound that matters: an operator adding an emergency TFR needs it live in seconds. Explicit
invalidation makes it immediate on the writing instance; the TTL bounds staleness on every
other replica. 30s is chosen so the worst case is stated and small, not because the load
requires it.

Cache misses on a failed query must not populate the cache with an empty set — that would turn
one failed query into a TTL-long window of open airspace. This is the fail-closed rule again,
in its easiest place to get wrong.

## Admin surface

Four routes on `AdminController`, ADMIN-only, matching the fleet registry's shape:

| Route | Audit action |
|---|---|
| `GET /admin/airspace` | — |
| `POST /admin/airspace` | `AIRSPACE_ZONE_CREATE` |
| `PATCH /admin/airspace/:id` | `AIRSPACE_ZONE_UPDATE` |
| `DELETE /admin/airspace/:id` | `AIRSPACE_ZONE_DEACTIVATE` |

Delete is a **deactivation** (`active = false`), not a row delete. An airspace zone that once
existed is part of the record of why a delivery was refused; hard-deleting it makes a past
refusal unexplainable.

All three mutations take an audit row via the increment-4 machinery — co-committed, sourced
through `pickAllowed`/`diffAllowed`, actor from `@AuditActor()`. This is the first new consumer
of that machinery and a real test of whether it generalises.

Three new `AdminAuditAction` enum values are required. **Postgres note:** `ALTER TYPE … ADD
VALUE` may not have its new value *used* in the same transaction, and Prisma wraps each
migration file in one. The enum extension must therefore not be combined with any statement
that writes a row using the new values. Seeding airspace zones does not use them, so a single
migration is fine — but the constraint must be stated so a later edit does not break it.

## Validation

- `radiusKm > 0` and bounded (a 20,000 km radius zone would ground the planet).
- `lat` ∈ [-90, 90], `lng` ∈ [-180, 180].
- `floorM < ceilingM` when both are given.
- `activeFrom < activeUntil` when both are given. Unlike the audit-log query's inverted range
  (deliberately left as an empty 200), an inverted window here is a **400** — it silently
  creates a zone that is never in force, which on an airspace surface reads as protection that
  does not exist.

## Migration

1. `CREATE TYPE "AirspaceZoneKind"`, extend `AdminAuditAction` with the three new values.
2. `CREATE TABLE "airspace_zones"` — plain, not partitioned.
3. **Seed Soekarno-Hatta and Halim** with the exact coordinates and radii from
   `serviceability.constants.ts`, `kind = AIRPORT`, no altitude bounds, no time window.
4. Delete `NO_FLY_ZONES` from the constants file.

Step 3 is load-bearing. Without it, step 4 opens the airspace the system currently protects and
nothing fails — the geometry code would simply find no zones.

## Testing

- Behaviour is **unchanged** for the two seeded zones: the existing serviceability tests must
  pass against DB-backed lookup with those rows present. This is the regression that matters.
- Fail-closed: a throwing zone query blocks with `NO_FLY_ZONE`, and does not poison the cache.
- Time window: in force / before / after / null-bounded, and `active=false` overriding a
  current window.
- Cache: a write invalidates immediately; a stale read refreshes.
- Altitude is stored and returned but does **not** relax a planning block.
- Deactivate does not delete the row.
- Each of the three mutations writes an audit row that co-commits — with an identity assertion
  on the transaction client, per the standard increment 4 landed on.
- Mutation testing before merge, as every increment in this phase has done.

## Out of scope

- Polygons, and any geometry beyond circles.
- In-flight breach detection against `floorM`/`ceilingM` (follow-up; the flight recorder
  already has the altitude).
- Any admin-repo UI (that is 12.5).
- Importing real aeronautical data (NOTAM/AIP feeds).
- Changing the quote-time-vs-launch-time asymmetry established in increment 2.
