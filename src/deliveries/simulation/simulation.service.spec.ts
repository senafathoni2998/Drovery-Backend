import { Test, TestingModule } from '@nestjs/testing';

import { SimulationService } from './simulation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import { ProofService } from '../proof/proof.service';
import { createMockPrismaService } from '../../test/prisma-mock';

describe('SimulationService', () => {
  let service: SimulationService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let trackingService: { updateTracking: jest.Mock; getTracking: jest.Mock };
  let trackingGateway: { broadcastTrackingUpdate: jest.Mock };
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = createMockPrismaService();
    trackingService = {
      updateTracking: jest.fn().mockResolvedValue({}),
      getTracking: jest.fn(),
    };
    trackingGateway = { broadcastTrackingUpdate: jest.fn() };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    const proofService = { createAutoProof: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TrackingService, useValue: trackingService },
        { provide: TrackingGateway, useValue: trackingGateway },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ProofService, useValue: proofService },
      ],
    }).compile();

    service = module.get<SimulationService>(SimulationService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('startSimulation', () => {
    it('should schedule timers for delivery progression', () => {
      service.startSimulation('delivery-1', 'user-1', {
        fromLat: -6.903,
        fromLng: 107.615,
        toLat: -6.922,
        toLng: 107.607,
      });

      // There should be pending timers (stage transitions + position updates)
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });

    it('should use default coords when none provided', () => {
      service.startSimulation('delivery-1', 'user-1');

      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });
  });

  describe('stopSimulation', () => {
    it('should clear all timers for the delivery', () => {
      service.startSimulation('delivery-1', 'user-1');
      const timerCountBefore = jest.getTimerCount();
      expect(timerCountBefore).toBeGreaterThan(0);

      service.stopSimulation('delivery-1');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('should do nothing if no simulation is running', () => {
      expect(() => service.stopSimulation('nonexistent')).not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up all active simulations', () => {
      service.startSimulation('delivery-1', 'user-1');
      service.startSimulation('delivery-2', 'user-2');

      service.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('stage transitions', () => {
    it('should skip transition if delivery was canceled', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        id: 'delivery-1',
        status: 'CANCELED',
      });

      service.startSimulation('delivery-1', 'user-1');

      // Advance to first stage (CONFIRMED at 10s)
      jest.advanceTimersByTime(10_000);
      await Promise.resolve(); // flush microtasks

      expect(prisma.delivery.update).not.toHaveBeenCalled();
    });
  });
});
