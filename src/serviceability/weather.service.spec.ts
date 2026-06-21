import { WeatherService } from './weather.service';

describe('WeatherService (mock mode)', () => {
  let weather: WeatherService;
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    // No apiKey → mock mode.
    const config = { get: jest.fn().mockReturnValue(undefined) };
    weather = new WeatherService(config as any, cache as any);
  });

  it('is deterministic for the same coordinates', async () => {
    const a = await weather.getConditions(-6.9, 107.6);
    cache.get.mockResolvedValue(null); // bypass cache for the 2nd call
    const b = await weather.getConditions(-6.9, 107.6);
    expect(b).toEqual(a);
    expect(a.source).toBe('mock');
  });

  it('caches the result (per coarse cell)', async () => {
    await weather.getConditions(-6.9, 107.6);
    expect(cache.set).toHaveBeenCalledWith(
      'weather:-6.9,107.6',
      expect.objectContaining({ source: 'mock' }),
      expect.any(Number),
    );
  });

  it('returns a flyable=false result for some coordinates (demo variety)', async () => {
    // Scan a grid; at least one cell should be non-flyable (storm/high wind).
    let sawUnflyable = false;
    for (let i = 0; i < 200 && !sawUnflyable; i++) {
      cache.get.mockResolvedValue(null);
      const c = await weather.getConditions(-6 - i * 0.13, 106 + i * 0.17);
      if (!c.flyable) sawUnflyable = true;
    }
    expect(sawUnflyable).toBe(true);
  });
});
