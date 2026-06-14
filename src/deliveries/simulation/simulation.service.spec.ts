import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';

import { SimulationService } from './simulation.service';
import { POSITION_TICK_COUNT, SIM_QUEUE, STAGES } from './simulation.constants';

describe('SimulationService', () => {
  let service: SimulationService;
  let queue: { addBulk: jest.Mock; add: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    queue = {
      addBulk: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue({}),
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

  describe('scheduleKickoff', () => {
    it('enqueues a single delayed kickoff job at the scheduled instant', async () => {
      const scheduledFor = new Date(Date.now() + 3_600_000); // +1h
      await service.scheduleKickoff('d-9', 'u-1', undefined, scheduledFor);

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = queue.add.mock.calls[0];
      expect(name).toBe('kickoff');
      expect(data).toMatchObject({ deliveryId: 'd-9', userId: 'u-1' });
      expect(opts.jobId).toBe('d-9-kickoff');
      // delay ~= 1h (allow scheduling jitter)
      expect(opts.delay).toBeGreaterThan(3_590_000);
      expect(opts.delay).toBeLessThanOrEqual(3_600_000);
    });

    it('clamps a past instant to a zero delay (fires immediately)', async () => {
      await service.scheduleKickoff(
        'd-10',
        'u-1',
        undefined,
        new Date(Date.now() - 5000),
      );
      expect(queue.add.mock.calls[0][2].delay).toBe(0);
    });
  });

  describe('stopSimulation', () => {
    it("removes the delivery's kickoff, stage and position jobs", async () => {
      await service.stopSimulation('d-1');

      const removed = queue.remove.mock.calls.map((c) => c[0]);
      expect(removed).toContain('d-1-kickoff');
      expect(removed).toContain('d-1:stage:0');
      expect(removed).toContain('d-1:pos:0');
      expect(queue.remove).toHaveBeenCalledTimes(
        1 + STAGES.length + POSITION_TICK_COUNT,
      );
    });

    it('swallows errors from removing non-existent jobs', async () => {
      queue.remove.mockRejectedValue(new Error('not found'));
      await expect(service.stopSimulation('d-1')).resolves.toBeUndefined();
    });
  });
});
