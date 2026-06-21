import { Test, TestingModule } from '@nestjs/testing';

import { CacheService, REDIS_CLIENT } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    redis = { get: jest.fn(), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('get', () => {
    it('parses a cached JSON value', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ a: 1 }));
      expect(await service.get('k')).toEqual({ a: 1 });
    });

    it('returns null on a miss', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.get('k')).toBeNull();
    });

    it('fails open (returns null) on a Redis error', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      expect(await service.get('k')).toBeNull();
    });
  });

  describe('set', () => {
    it('serializes the value with an EX ttl', async () => {
      redis.set.mockResolvedValue('OK');
      await service.set('k', { a: 1 }, 60);
      expect(redis.set).toHaveBeenCalledWith(
        'k',
        JSON.stringify({ a: 1 }),
        'EX',
        60,
      );
    });

    it('swallows Redis errors', async () => {
      redis.set.mockRejectedValue(new Error('redis down'));
      await expect(service.set('k', 1, 60)).resolves.toBeUndefined();
    });
  });
});
