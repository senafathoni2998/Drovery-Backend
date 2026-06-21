import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;
  let config: { get: jest.Mock };
  const metrics = {
    contentType: 'text/plain; version=0.0.4',
    metrics: jest.fn().mockResolvedValue('drovery_queue_jobs 0\n'),
  };

  const mockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    res.send = jest.fn();
    res.end = jest.fn();
    return res;
  };

  beforeEach(async () => {
    config = { get: jest.fn().mockReturnValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        { provide: MetricsService, useValue: metrics },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    controller = module.get<MetricsController>(MetricsController);
    jest.clearAllMocks();
  });

  it('serves the exposition text with the prometheus content type', async () => {
    config.get.mockReturnValue(true);
    const res = mockRes();
    await controller.scrape(res);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/plain; version=0.0.4',
    );
    expect(res.send).toHaveBeenCalledWith('drovery_queue_jobs 0\n');
  });

  it('returns 404 when METRICS_ENABLED=false (kill switch)', async () => {
    config.get.mockReturnValue(false);
    const res = mockRes();
    await controller.scrape(res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });
});
