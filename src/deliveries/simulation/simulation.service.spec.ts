import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';

import { SimulationService } from './simulation.service';
import {
  POSITION_TICK_COUNT,
  SIM_QUEUE,
  STAGES,
} from './simulation.constants';

describe('SimulationService', () => {
  let service: SimulationService;
  let queue: { addBulk: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    queue = {
      addBulk: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        { provide: getQueueToken(SIM_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<SimulationService>(SimulationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('startSimulation', () => {
    it('enqueues a delayed job per stage plus the position ticks', async () => {
      await service.startSimulation('d-1', 'u-1', {
        fromLat: -6.9,
        fromLng: 107.6,
        toLat: -6.92,
        toLng: 107.62,
      });

      expect(queue.addBulk).toHaveBeenCalledTimes(1);
      const jobs = queue.addBulk.mock.calls[0][0];
      const stageJobs = jobs.filter((j: any) => j.name === 'stage');
      const posJobs = jobs.filter((j: any) => j.name === 'position');

      expect(stageJobs).toHaveLength(STAGES.length);
      expect(posJobs).toHaveLength(POSITION_TICK_COUNT);
      // deterministic job ids + delay for idempotency / cancellation
      expect(stageJobs[0].opts.jobId).toBe('d-1:stage:0');
      expect(stageJobs[0].opts.delay).toBe(STAGES[0].delayMs);
      expect(posJobs[0].opts.jobId).toBe('d-1:pos:0');
    });

    it('falls back to default coords when none are provided', async () => {
      await service.startSimulation('d-2', 'u-1');
      expect(queue.addBulk).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopSimulation', () => {
    it("removes the delivery's stage and position jobs", async () => {
      await service.stopSimulation('d-1');

      const removed = queue.remove.mock.calls.map((c) => c[0]);
      expect(removed).toContain('d-1:stage:0');
      expect(removed).toContain('d-1:pos:0');
      expect(queue.remove).toHaveBeenCalledTimes(
        STAGES.length + POSITION_TICK_COUNT,
      );
    });

    it('swallows errors from removing non-existent jobs', async () => {
      queue.remove.mockRejectedValue(new Error('not found'));
      await expect(service.stopSimulation('d-1')).resolves.toBeUndefined();
    });
  });
});
