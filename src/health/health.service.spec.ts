import { Test, TestingModule } from '@nestjs/testing';

import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let cache: { ping: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    cache = { ping: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('reports both up when DB query + Redis ping succeed', async () => {
    (prisma as any).$queryRaw = jest.fn().mockResolvedValue([{ ok: 1 }]);
    cache.ping.mockResolvedValue(true);

    expect(await service.check()).toEqual({ database: true, redis: true });
  });

  it('reports database:false when the DB query throws', async () => {
    (prisma as any).$queryRaw = jest.fn().mockRejectedValue(new Error('down'));
    cache.ping.mockResolvedValue(true);

    expect(await service.check()).toEqual({ database: false, redis: true });
  });

  it('reports redis:false when the ping fails', async () => {
    (prisma as any).$queryRaw = jest.fn().mockResolvedValue([{ ok: 1 }]);
    cache.ping.mockResolvedValue(false);

    expect(await service.check()).toEqual({ database: true, redis: false });
  });
});
