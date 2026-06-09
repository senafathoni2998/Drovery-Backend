import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';

import { MetricsService } from './metrics.service';
import { SIM_QUEUE } from '../deliveries/simulation/simulation.constants';

describe('MetricsService', () => {
  let service: MetricsService;
  let queue: { getJobCounts: jest.Mock };

  beforeEach(async () => {
    queue = {
      getJobCounts: jest
        .fn()
        .mockResolvedValue({ waiting: 3, active: 1, delayed: 7, failed: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getQueueToken(SIM_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('exposes the prometheus content type', () => {
    expect(service.contentType).toContain('text/plain');
  });

  it('renders default + http + queue metric families', async () => {
    const out = await service.metrics();
    expect(out).toContain('drovery_queue_jobs');
    expect(out).toContain('drovery_http_request_duration_seconds');
    // collectDefaultMetrics ran with the drovery_ prefix.
    expect(out).toMatch(/drovery_process_cpu|drovery_nodejs_/);
  });

  it('collects queue depth from getJobCounts on scrape, labelled by state', async () => {
    const out = await service.metrics();
    expect(queue.getJobCounts).toHaveBeenCalled();
    expect(out).toContain(
      `drovery_queue_jobs{queue="${SIM_QUEUE}",state="delayed"} 7`,
    );
    expect(out).toContain(
      `drovery_queue_jobs{queue="${SIM_QUEUE}",state="waiting"} 3`,
    );
  });

  it('still renders the rest of the registry when getJobCounts rejects (Redis down)', async () => {
    queue.getJobCounts.mockRejectedValueOnce(new Error('redis down'));
    // Must NOT throw — a queue failure should not fail the whole /metrics scrape.
    const out = await service.metrics();
    expect(out).toContain('drovery_http_request_duration_seconds');
    expect(out).toMatch(/drovery_process_cpu|drovery_nodejs_/);
  });

  it('does not hang the scrape when getJobCounts never resolves (timeout)', async () => {
    // The BullMQ connection queues commands offline when Redis is down, so
    // getJobCounts() HANGS rather than rejecting. The collect timeout must keep
    // /metrics responsive regardless.
    queue.getJobCounts.mockReturnValue(new Promise(() => {})); // never resolves
    const out = await service.metrics();
    expect(out).toContain('drovery_http_request_duration_seconds');
  }, 5000);

  it('records http requests with method/status/route labels', async () => {
    const labels = { method: 'GET', status: '200', route: '/api/v1/health' };
    service.httpTotal.inc(labels);
    service.httpDuration.observe(labels, 0.05);

    const out = await service.metrics();
    expect(out).toContain('route="/api/v1/health"');
    expect(out).toContain('drovery_http_requests_total');
  });
});
