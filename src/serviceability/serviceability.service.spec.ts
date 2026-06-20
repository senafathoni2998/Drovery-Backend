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
