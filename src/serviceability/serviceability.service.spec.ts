import { ServiceabilityService } from './serviceability.service';
import { WeatherConditions } from './weather.service';

const flyable: WeatherConditions = {
  windKph: 8,
  condition: 'clear',
  flyable: true,
  source: 'mock',
};

describe('ServiceabilityService', () => {
  let service: ServiceabilityService;
  let weather: { getConditions: jest.Mock };

  beforeEach(() => {
    weather = { getConditions: jest.fn().mockResolvedValue(flyable) };
    service = new ServiceabilityService(weather as any);
  });

  // The seeded demo route (DEFAULT_COORDS) is in Bandung — MUST be serviceable.
  it('passes the Bandung demo route', async () => {
    const r = await service.checkServiceability(
      -6.903,
      107.615,
      -6.922,
      107.607,
    );
    expect(r).toEqual({
      serviceable: true,
      reasons: [],
      codes: [],
      weatherHold: false,
    });
  });

  it('rejects out-of-area (Surabaya pickup) with OUT_OF_AREA', async () => {
    const r = await service.checkServiceability(
      -7.2575,
      112.7521,
      -6.922,
      107.607,
    );
    expect(r.serviceable).toBe(false);
    expect(r.codes).toContain('OUT_OF_AREA');
  });

  it('SERVICE_AREA_GLOBAL=true makes anywhere serviceable (e.g. a London route)', async () => {
    const prev = process.env.SERVICE_AREA_GLOBAL;
    process.env.SERVICE_AREA_GLOBAL = 'true';
    try {
      // Both endpoints far outside any configured hub — rejected by default, allowed in global mode.
      const r = await service.checkServiceability(
        51.5074,
        -0.1278,
        51.5155,
        -0.1426,
      );
      expect(r.serviceable).toBe(true);
      expect(r.codes).not.toContain('OUT_OF_AREA');
    } finally {
      if (prev === undefined) delete process.env.SERVICE_AREA_GLOBAL;
      else process.env.SERVICE_AREA_GLOBAL = prev;
    }
  });

  describe('route length — the physics bound', () => {
    const withGlobal = async (fn: () => Promise<void>) => {
      const prev = process.env.SERVICE_AREA_GLOBAL;
      process.env.SERVICE_AREA_GLOBAL = 'true';
      try {
        await fn();
      } finally {
        if (prev === undefined) delete process.env.SERVICE_AREA_GLOBAL;
        else process.env.SERVICE_AREA_GLOBAL = prev;
      }
    };

    it('rejects Jakarta → London, which global mode used to wave through', async () => {
      // The exact hole: SERVICE_AREA_GLOBAL makes the area check vacuous, so an
      // ~11,000 km route was serviceable, priced, and accepted for dispatch.
      await withGlobal(async () => {
        const r = await service.checkServiceability(
          -6.2088,
          106.8456,
          51.5074,
          -0.1278,
        );
        expect(r.serviceable).toBe(false);
        expect(r.codes).toContain('ROUTE_TOO_LONG');
        expect(r.weatherHold).toBe(false); // hard, not retryable
        expect(r.params).toMatchObject({ maxKm: expect.any(Number) });
      });
    });

    it('rejects a too-long route even when BOTH endpoints are in a real service area', async () => {
      // The geofence does not save you either: the two configured hubs are ~120 km
      // apart, so a Jakarta pickup with a Bandung dropoff is in-area at both ends
      // and still unflyable by any battery-electric multirotor.
      const r = await service.checkServiceability(
        -6.2088,
        106.8456,
        -6.9125,
        107.611,
      );
      expect(r.serviceable).toBe(false);
      expect(r.codes).toContain('ROUTE_TOO_LONG');
    });

    it('is checked BEFORE the weather call — a physically impossible route costs no I/O', async () => {
      await withGlobal(async () => {
        await service.checkServiceability(-6.2088, 106.8456, 51.5074, -0.1278);
        expect(weather.getConditions).not.toHaveBeenCalled();
      });
    });

    it('honors MAX_ROUTE_KM for a longer-range fleet', async () => {
      const prev = process.env.MAX_ROUTE_KM;
      process.env.MAX_ROUTE_KM = '200';
      try {
        // Jakarta → Bandung, rejected at the 50 km default, allowed at 200.
        const r = await service.checkServiceability(
          -6.2088,
          106.8456,
          -6.9125,
          107.611,
        );
        expect(r.codes).not.toContain('ROUTE_TOO_LONG');
      } finally {
        if (prev === undefined) delete process.env.MAX_ROUTE_KM;
        else process.env.MAX_ROUTE_KM = prev;
      }
    });

    it('ignores a garbage MAX_ROUTE_KM rather than disabling the bound', async () => {
      // An unparseable or non-positive override must not silently become "no limit".
      for (const bad of ['banana', '0', '-10', '']) {
        process.env.MAX_ROUTE_KM = bad;
        const r = await service.checkServiceability(
          -6.2088,
          106.8456,
          -6.9125,
          107.611,
        );
        expect(r.codes).toContain('ROUTE_TOO_LONG');
      }
      delete process.env.MAX_ROUTE_KM;
    });
  });

  it('rejects an endpoint inside a no-fly zone (CGK airport)', async () => {
    const r = await service.checkServiceability(
      -6.1256,
      106.6558, // CGK center
      -6.2088,
      106.8456, // Jakarta center
    );
    expect(r.serviceable).toBe(false);
    expect(r.codes).toContain('NO_FLY_ZONE');
  });

  it('rejects a route that passes THROUGH a no-fly zone (endpoints clear)', async () => {
    // Both endpoints are in-area and outside HLP's 3 km zone, but the straight
    // line crosses directly over HLP (-6.2647, 106.9308).
    const r = await service.checkServiceability(
      -6.2647,
      106.88,
      -6.2647,
      106.98,
    );
    expect(r.serviceable).toBe(false);
    expect(r.codes).toEqual(['NO_FLY_ZONE']);
    // The zone name is surfaced as a localization param ({zoneName}), not just baked
    // into the English reason string.
    expect(r.params?.zoneName).toBeDefined();
  });

  it('holds for a storm (soft, weatherHold) without a hard code', async () => {
    weather.getConditions.mockResolvedValue({
      windKph: 60,
      condition: 'storm',
      flyable: false,
      source: 'mock',
    });
    const r = await service.checkServiceability(
      -6.903,
      107.615,
      -6.922,
      107.607,
    );
    expect(r.serviceable).toBe(false);
    expect(r.codes).toEqual(['WEATHER_STORM']);
    expect(r.weatherHold).toBe(true);
  });

  it('holds for high wind (WEATHER_HOLD)', async () => {
    weather.getConditions.mockResolvedValue({
      windKph: 47,
      condition: 'rain',
      flyable: false,
      source: 'mock',
    });
    const r = await service.checkServiceability(
      -6.903,
      107.615,
      -6.922,
      107.607,
    );
    expect(r.codes).toEqual(['WEATHER_HOLD']);
    expect(r.params?.windKph).toBe(47); // surfaced as a localization param
    expect(r.weatherHold).toBe(true);
  });

  it('fails open: a weather error never grounds a serviceable route', async () => {
    weather.getConditions.mockRejectedValue(new Error('weather api down'));
    const r = await service.checkServiceability(
      -6.903,
      107.615,
      -6.922,
      107.607,
    );
    expect(r.serviceable).toBe(true);
    expect(r.codes).toEqual([]);
  });
});
