import { usableRangeKm } from '../../dispatch/flight-feasibility';
import { haversineKm } from '../../common/geo-distance';
import { assessRecall, EnergyAircraft } from './energy';
import {
  CRITICAL_BATTERY_PERCENT,
  RETURN_TRIGGER_MARGIN,
} from './flight-recorder.constants';

const BASE = { lat: -6.9125, lng: 107.611 };

const drone = (over: Partial<EnergyAircraft> = {}): EnergyAircraft => ({
  maxPayloadKg: 5,
  rangeKm: 20,
  homeBaseLat: BASE.lat,
  homeBaseLng: BASE.lng,
  ...over,
});

/** A position `km` east of the home base. */
const at = (km: number, batteryPercent: number) => ({
  lat: BASE.lat,
  lng: BASE.lng + km / 111,
  batteryPercent,
});

describe('assessRecall', () => {
  it('leaves a healthy aircraft near its base alone', () => {
    expect(assessRecall(drone(), at(2, 90), 1)).toMatchObject({
      recall: false,
    });
  });

  it('recalls on charge alone, however close to base it is', () => {
    // The backstop fires when the numbers are unreliable rather than unfavourable.
    // Sitting on the pad at 10% is not a reason to keep flying.
    const verdict = assessRecall(drone(), at(0.1, CRITICAL_BATTERY_PERCENT), 1);
    expect(verdict).toMatchObject({
      recall: true,
      reason: 'CRITICAL_BATTERY',
    });
  });

  it('treats the critical threshold as inclusive', () => {
    expect(
      assessRecall(drone(), at(0.1, CRITICAL_BATTERY_PERCENT), 1).recall,
    ).toBe(true);
    expect(
      assessRecall(drone(), at(0.1, CRITICAL_BATTERY_PERCENT + 1), 1).recall,
    ).toBe(false);
  });

  it('recalls when the remaining range no longer covers the way home', () => {
    // 8 km out on a 20 km airframe at 40% — the budget after reserve and payload
    // derate is under the distance back.
    const verdict = assessRecall(drone(), at(8, 40), 1);
    expect(verdict).toMatchObject({
      recall: true,
      reason: 'INSUFFICIENT_RANGE_HOME',
    });
    expect(verdict.distanceHomeKm).toBeGreaterThan(verdict.remainingRangeKm);
  });

  it('fires BEFORE the aircraft is exactly out of range, not at the moment it is', () => {
    // The margin buys the round trip a recall itself takes: issue, poll, fetch,
    // ack, then fly — during all of which the drone is still heading away.
    const d = drone();
    const battery = 60;
    const budget = usableRangeKm(
      {
        rangeKm: d.rangeKm,
        maxPayloadKg: d.maxPayloadKg,
        batteryPercent: battery,
      },
      1,
    );

    // Sit the aircraft just INSIDE the raw budget but outside the margined one.
    const distance = budget / RETURN_TRIGGER_MARGIN + 0.05;
    const reading = at(distance, battery);
    const actualKm = haversineKm(
      reading.lat,
      reading.lng,
      d.homeBaseLat,
      d.homeBaseLng,
    );

    expect(actualKm).toBeLessThan(budget); // it COULD still make it
    expect(assessRecall(d, reading, 1)).toMatchObject({
      recall: true,
      reason: 'INSUFFICIENT_RANGE_HOME',
    });
  });

  it('turns a loaded drone back sooner than an empty one', () => {
    // Range is derated by payload fraction, so the same position and charge is
    // safe carrying nothing and not safe carrying the rated maximum.
    const d = drone();
    const reading = at(6.5, 55);

    expect(assessRecall(d, reading, 0).recall).toBe(false);
    expect(assessRecall(d, reading, 5)).toMatchObject({
      recall: true,
      reason: 'INSUFFICIENT_RANGE_HOME',
    });
  });

  it('reports CHARGE first when both triggers fire', () => {
    // Deliberately a case where BOTH are true — flat AND far from home — so the
    // reported reason is decided purely by check order. Charge has to win: it is
    // the input that cannot be wrong about itself, and it is what an operator
    // reading the alert needs to see. Geometry-first would report a range problem
    // for an aircraft that is simply out of battery.
    const d = drone();
    const reading = at(15, CRITICAL_BATTERY_PERCENT - 5);

    // Prove the geometry trigger would ALSO have fired on its own.
    const geometryAlone = assessRecall(d, at(15, 60), 1);
    expect(geometryAlone).toMatchObject({
      recall: true,
      reason: 'INSUFFICIENT_RANGE_HOME',
    });

    expect(assessRecall(d, reading, 1).reason).toBe('CRITICAL_BATTERY');
  });

  it('is not saved from a flat battery by a mis-set fleet row', () => {
    // A nonsense rangeKm would let a geometry check conclude a nearly dead
    // aircraft is comfortably within budget.
    const verdict = assessRecall(
      drone({ rangeKm: 100_000 }),
      at(1, CRITICAL_BATTERY_PERCENT - 5),
      1,
    );
    expect(verdict).toMatchObject({ recall: true, reason: 'CRITICAL_BATTERY' });
  });

  it('recalls a drone whose fleet row says it has no range at all', () => {
    // usableRangeKm returns 0 for a nonsensical row, so the comparison must come
    // out as "cannot get home" — never as a pass.
    expect(assessRecall(drone({ rangeKm: 0 }), at(1, 90), 1)).toMatchObject({
      recall: true,
      reason: 'INSUFFICIENT_RANGE_HOME',
    });
  });

  it('always reports both distances, so the log explains the decision', () => {
    const verdict = assessRecall(drone(), at(3, 80), 1);
    expect(verdict.distanceHomeKm).toBeCloseTo(3, 1);
    expect(verdict.remainingRangeKm).toBeGreaterThan(0);
  });
});
