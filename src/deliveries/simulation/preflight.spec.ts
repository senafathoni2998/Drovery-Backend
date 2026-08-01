import { ServiceabilityResult } from '../../serviceability/serviceability.types';
import { classifyPreflight, holdExhausted } from './preflight';
import { PREFLIGHT_MAX_ATTEMPTS } from './preflight.constants';

const result = (over: Partial<ServiceabilityResult>): ServiceabilityResult => ({
  serviceable: false,
  reasons: [],
  codes: [],
  weatherHold: false,
  ...over,
});

describe('classifyPreflight', () => {
  it('launches when conditions are good', () => {
    expect(classifyPreflight(result({ serviceable: true }))).toEqual({
      action: 'LAUNCH',
    });
  });

  it('HOLDS for weather — the only thing that gets better by waiting', () => {
    const verdict = classifyPreflight(
      result({ codes: ['WEATHER_STORM'], weatherHold: true }),
    );
    expect(verdict).toMatchObject({ action: 'HOLD', code: 'WEATHER_STORM' });
  });

  it('holds a wind hold too', () => {
    expect(
      classifyPreflight(result({ codes: ['WEATHER_HOLD'], weatherHold: true })),
    ).toMatchObject({ action: 'HOLD', code: 'WEATHER_HOLD' });
  });

  it('ABORTS a no-fly zone rather than waiting for it to move', () => {
    // Holding on a permanent blocker leaves the delivery in SCHEDULED, looking to
    // its customer exactly like one that is about to happen, until it expires.
    expect(classifyPreflight(result({ codes: ['NO_FLY_ZONE'] }))).toMatchObject(
      {
        action: 'ABORT',
        code: 'NO_FLY_ZONE',
        reason: 'UNSAFE_DROP_ZONE',
      },
    );
  });

  it('aborts an out-of-area route', () => {
    expect(classifyPreflight(result({ codes: ['OUT_OF_AREA'] }))).toMatchObject(
      {
        action: 'ABORT',
        code: 'OUT_OF_AREA',
      },
    );
  });

  it('aborts a route no drone can fly', () => {
    expect(
      classifyPreflight(result({ codes: ['ROUTE_TOO_LONG'] })),
    ).toMatchObject({ action: 'ABORT', code: 'ROUTE_TOO_LONG' });
  });

  it('always stamps a service-fault reason, so the customer is refunded', () => {
    // Nothing here is the customer's doing: they booked a delivery we accepted and
    // then could not fly. RECIPIENT_UNAVAILABLE is the only non-refunding reason
    // and it must never come out of here.
    for (const code of ['NO_FLY_ZONE', 'OUT_OF_AREA', 'ROUTE_TOO_LONG']) {
      const verdict = classifyPreflight(result({ codes: [code] as never }));
      expect(verdict.reason).not.toBe('RECIPIENT_UNAVAILABLE');
    }
  });

  it('picks the NON-weather code when a result carries both', () => {
    // weatherHold false means something hard is blocking; the reported code has to
    // be that one, or the log blames the weather for a no-fly zone.
    const verdict = classifyPreflight(
      result({ codes: ['WEATHER_HOLD', 'NO_FLY_ZONE'] as never }),
    );
    expect(verdict).toMatchObject({ action: 'ABORT', code: 'NO_FLY_ZONE' });
  });
});

describe('holdExhausted', () => {
  it('lets the budgeted attempts through', () => {
    for (let i = 0; i < PREFLIGHT_MAX_ATTEMPTS - 1; i++) {
      expect(holdExhausted(i, PREFLIGHT_MAX_ATTEMPTS)).toBe(false);
    }
  });

  it('stops at the budget rather than one past it', () => {
    // Off by one here means either a wasted hold or one fewer chance for the
    // weather to clear than the constant advertises.
    expect(
      holdExhausted(PREFLIGHT_MAX_ATTEMPTS - 1, PREFLIGHT_MAX_ATTEMPTS),
    ).toBe(true);
  });

  it('is exhausted immediately for a zero budget', () => {
    expect(holdExhausted(0, 0)).toBe(true);
  });
});
