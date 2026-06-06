import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };

  beforeEach(async () => {
    health = { check: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('live() returns ok + uptime without touching dependencies', () => {
    const result = controller.live();
    expect(result.status).toBe('ok');
    expect(typeof result.uptime).toBe('number');
    expect(health.check).not.toHaveBeenCalled();
  });

  it('ready() returns ok when all checks pass', async () => {
    health.check.mockResolvedValue({ database: true, redis: true });
    const result = await controller.ready();
    expect(result).toEqual({
      status: 'ok',
      checks: { database: true, redis: true },
    });
  });

  it('ready() throws 503 when a dependency is down', async () => {
    health.check.mockResolvedValue({ database: true, redis: false });
    await expect(controller.ready()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
