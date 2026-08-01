import {
  assessFeasibility,
  FeasibilityAircraft,
  missionDistanceKm,
  MissionRoute,
  rankCandidates,
  usableRangeKm,
} from './flight-feasibility';
import {
  MIN_DISPATCH_BATTERY_PERCENT,
  PAYLOAD_RANGE_PENALTY,
  RANGE_RESERVE_FRACTION,
} from './dispatch.constants';

// Bandung, roughly. Real coordinates so the distances are real distances and a
// broken haversine shows up as a wrong number rather than a wrong sign.
const BASE = { lat: -6.9125, lng: 107.611 };

const drone = (
  over: Partial<FeasibilityAircraft> = {},
): FeasibilityAircraft => ({
  id: 'd1',
  maxPayloadKg: 5,
  rangeKm: 20,
  batteryPercent: 100,
  homeBaseLat: BASE.lat,
  homeBaseLng: BASE.lng,
  currentLat: null,
  currentLng: null,
  ...over,
});

/** A route offset roughly `km` east of the base, both endpoints. */
const routeNear = (km: number): MissionRoute => ({
  fromLat: BASE.lat,
  fromLng: BASE.lng + km / 111,
  toLat: BASE.lat,
  toLng: BASE.lng + (km + 1) / 111,
});

describe('missionDistanceKm', () => {
  it('counts the return leg, not just the delivery', () => {
    // The whole point: a drone that reaches the dropoff and cannot get home has
    // not completed a mission. A 1 km delivery 5 km from base is a ~11 km flight.
    const route = routeNear(5);
    const km = missionDistanceKm(drone(), route);

    const deliveryLegKm = 1;
    expect(km).toBeGreaterThan(deliveryLegKm * 3);
    expect(km).toBeCloseTo(5 + 1 + 6, 0); // out + across + home
  });

  it('flies from where the aircraft actually IS, not from its pad', () => {
    const route = routeNear(2);
    const atBase = missionDistanceKm(drone(), route);
    // Same airframe, currently parked 20 km the wrong way.
    const displaced = missionDistanceKm(
      drone({ currentLat: BASE.lat, currentLng: BASE.lng - 20 / 111 }),
      route,
    );

    expect(displaced).toBeGreaterThan(atBase + 15);
  });

  it('falls back to the home base before the first telemetry frame', () => {
    // currentLat/Lng are null until a drone has ever flown — it is on its pad.
    const route = routeNear(3);
    expect(
      missionDistanceKm(drone({ currentLat: null, currentLng: null }), route),
    ).toBeCloseTo(
      missionDistanceKm(
        drone({ currentLat: BASE.lat, currentLng: BASE.lng }),
        route,
      ),
      6,
    );
  });
});

describe('usableRangeKm', () => {
  it('spends neither the reserve nor the charge it does not have', () => {
    const half = usableRangeKm(drone({ batteryPercent: 50 }), 0);
    expect(half).toBeCloseTo(20 * 0.5 * (1 - RANGE_RESERVE_FRACTION), 6);
  });

  it('derates for payload — a loaded drone does not fly as far as an empty one', () => {
    const empty = usableRangeKm(drone(), 0);
    const loaded = usableRangeKm(drone(), 5); // rated maximum

    expect(loaded).toBeLessThan(empty);
    expect(loaded).toBeCloseTo(empty * (1 - PAYLOAD_RANGE_PENALTY), 6);
  });

  it('never derates past 100% for an over-rated payload', () => {
    // The capacity check rejects these, but a negative range budget here would be
    // a silent absurdity rather than a rejection.
    expect(usableRangeKm(drone(), 500)).toBeGreaterThan(0);
  });

  it('returns 0 — never NaN or negative — for a nonsensical fleet row', () => {
    // A bad row must only ever make an aircraft INELIGIBLE, never eligible.
    expect(usableRangeKm(drone({ rangeKm: 0 }), 1)).toBe(0);
    expect(usableRangeKm(drone({ rangeKm: -5 }), 1)).toBe(0);
    expect(usableRangeKm(drone({ maxPayloadKg: 0 }), 1)).toBe(0);
  });

  it('clamps a nonsense battery reading instead of trusting it', () => {
    expect(usableRangeKm(drone({ batteryPercent: 300 }), 0)).toBeCloseTo(
      usableRangeKm(drone({ batteryPercent: 100 }), 0),
      6,
    );
    expect(usableRangeKm(drone({ batteryPercent: -10 }), 0)).toBe(0);
  });
});

describe('assessFeasibility', () => {
  const route = routeNear(2);

  it('accepts an aircraft that can lift it, reach it and get home', () => {
    expect(assessFeasibility(drone(), route, 1)).toMatchObject({
      feasible: true,
    });
  });

  it('reports CAPACITY first — the only reason that will not change with time', () => {
    // This distinction is what lets the caller say "too heavy for us" instead of
    // the useless "try again later". A flat, out-of-range, too-small drone must
    // still report CAPACITY.
    const verdict = assessFeasibility(
      drone({ maxPayloadKg: 1, batteryPercent: 5, rangeKm: 0.1 }),
      route,
      4,
    );
    expect(verdict).toMatchObject({ feasible: false, reason: 'CAPACITY' });
  });

  it('refuses a drone too flat to trust, even when the arithmetic fits', () => {
    // Below the floor the remaining-range estimate is unreliable in exactly the
    // regime where being wrong is unrecoverable.
    const flat = drone({
      batteryPercent: MIN_DISPATCH_BATTERY_PERCENT - 1,
      rangeKm: 10_000, // energy is not the binding constraint here
    });
    expect(assessFeasibility(flat, route, 1)).toMatchObject({
      feasible: false,
      reason: 'BATTERY',
    });
  });

  it('refuses a mission that fits the delivery leg but not the flight home', () => {
    // Sized so the ONE-WAY trip fits the budget and the round trip does not: this
    // is the test that fails if the recovery leg is ever dropped from the mission.
    const route20 = routeNear(20);
    const oneWayKm = 20 + 1;
    const shortLegged = drone({ rangeKm: 45 });
    const budget = usableRangeKm(shortLegged, 1);

    expect(budget).toBeGreaterThan(oneWayKm); // it can GET there
    expect(missionDistanceKm(shortLegged, route20)).toBeGreaterThan(budget); // not back
    expect(assessFeasibility(shortLegged, route20, 1)).toMatchObject({
      feasible: false,
      reason: 'RANGE',
    });
  });

  it('is decided by the DERATED budget, not the bench figure', () => {
    const route = routeNear(4);
    const mission = missionDistanceKm(drone(), route);
    // Range set between the raw number and the number after reserve+payload.
    const marginal = drone({ rangeKm: mission * 1.05 });

    expect(marginal.rangeKm).toBeGreaterThan(mission); // "fits" on paper
    expect(assessFeasibility(marginal, route, 5)).toMatchObject({
      feasible: false,
      reason: 'RANGE',
    });
  });
});

describe('rankCandidates', () => {
  const route = routeNear(2);

  it('drops the infeasible instead of ranking them', () => {
    const ranked = rankCandidates(
      [
        drone({ id: 'too-small', maxPayloadKg: 0.5 }),
        drone({ id: 'ok' }),
        drone({ id: 'flat', batteryPercent: 3 }),
      ],
      route,
      2,
    );
    expect(ranked.map((r) => r.drone.id)).toEqual(['ok']);
  });

  it('preserves scarce capability: smallest sufficient airframe wins', () => {
    // Sending the heavy-lift drone on a 200 g job is locally optimal and globally
    // wrong — it is the only aircraft that can take the next heavy booking.
    const ranked = rankCandidates(
      [
        drone({ id: 'heavy', maxPayloadKg: 25 }),
        drone({ id: 'medium', maxPayloadKg: 5 }),
        drone({ id: 'light', maxPayloadKg: 2 }),
      ],
      route,
      1,
    );
    expect(ranked.map((r) => r.drone.id)).toEqual(['light', 'medium', 'heavy']);
  });

  it('breaks a capacity tie by shortest mission', () => {
    const near = drone({ id: 'near' });
    const far = drone({
      id: 'far',
      currentLat: BASE.lat,
      currentLng: BASE.lng + 5 / 111,
    });
    const ranked = rankCandidates([far, near], route, 1);
    expect(ranked[0].drone.id).toBe('near');
  });

  it('is deterministic for two identical airframes', () => {
    // Otherwise a spec asserting which one is claimed is flaky, not wrong.
    const a = drone({ id: 'aaa' });
    const b = drone({ id: 'bbb' });
    expect(rankCandidates([b, a], route, 1).map((r) => r.drone.id)).toEqual([
      'aaa',
      'bbb',
    ]);
    expect(rankCandidates([a, b], route, 1).map((r) => r.drone.id)).toEqual([
      'aaa',
      'bbb',
    ]);
  });

  it('returns nothing when nothing can fly it', () => {
    expect(rankCandidates([], route, 1)).toEqual([]);
    expect(rankCandidates([drone({ maxPayloadKg: 0.1 })], route, 5)).toEqual(
      [],
    );
  });
});
