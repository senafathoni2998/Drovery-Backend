import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { RecurringDeliveriesService } from './recurring-deliveries.service';

describe('RecurringDeliveriesService', () => {
  let service: RecurringDeliveriesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  const userId = 'u-1';

  const template = {
    fromAddress: 'A',
    toAddress: 'B',
    receiver: 'R',
    packages: 'Box',
    packageSize: 'Medium',
    packageWeight: 2,
    packageTypes: ['electronics'],
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringDeliveriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(RecurringDeliveriesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('computes nextRunAt and persists a DAILY schedule', async () => {
      prisma.recurringDelivery.create.mockResolvedValue({ id: 'r-1' });
      await service.create(userId, {
        freq: 'DAILY' as any,
        timeOfDay: '08:00',
        ...template,
      } as any);

      const data = prisma.recurringDelivery.create.mock.calls[0][0].data;
      expect(data.userId).toBe(userId);
      expect(data.freq).toBe('DAILY');
      expect(data.daysOfWeek).toEqual([]); // DAILY ignores daysOfWeek
      expect(data.nextRunAt).toBeInstanceOf(Date);
    });

    it('ignores daysOfWeek for DAILY even if supplied', async () => {
      prisma.recurringDelivery.create.mockResolvedValue({ id: 'r-1' });
      await service.create(userId, {
        freq: 'DAILY' as any,
        daysOfWeek: [1, 2, 3],
        timeOfDay: '08:00',
        ...template,
      } as any);
      expect(
        prisma.recurringDelivery.create.mock.calls[0][0].data.daysOfWeek,
      ).toEqual([]);
    });

    it('dedups + sorts daysOfWeek for WEEKLY and persists them', async () => {
      prisma.recurringDelivery.create.mockResolvedValue({ id: 'r-1' });
      await service.create(userId, {
        freq: 'WEEKLY' as any,
        daysOfWeek: [5, 1, 5, 3],
        timeOfDay: '09:00',
        ...template,
      } as any);
      expect(
        prisma.recurringDelivery.create.mock.calls[0][0].data.daysOfWeek,
      ).toEqual([1, 3, 5]);
    });

    it('rejects WEEKLY with no days', async () => {
      await expect(
        service.create(userId, {
          freq: 'WEEKLY' as any,
          timeOfDay: '09:00',
          ...template,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects endDate before startDate', async () => {
      await expect(
        service.create(userId, {
          freq: 'DAILY' as any,
          timeOfDay: '08:00',
          startDate: '2026-06-10T00:00:00.000Z',
          endDate: '2026-06-01T00:00:00.000Z',
          ...template,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a schedule that produces no future occurrence', async () => {
      await expect(
        service.create(userId, {
          freq: 'DAILY' as any,
          timeOfDay: '08:00',
          endDate: '2020-01-01T00:00:00.000Z',
          ...template,
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringDelivery.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('applies the active filter from activeFilter (false → active:false)', async () => {
      prisma.recurringDelivery.findMany.mockResolvedValue([]);
      prisma.recurringDelivery.count.mockResolvedValue(0);
      await service.findAll(userId, {
        activeFilter: false,
        skip: 0,
        limit: 20,
        page: 1,
      } as any);
      expect(prisma.recurringDelivery.findMany.mock.calls[0][0].where).toEqual({
        userId,
        active: false,
      });
    });

    it('omits the active filter when activeFilter is undefined', async () => {
      prisma.recurringDelivery.findMany.mockResolvedValue([]);
      prisma.recurringDelivery.count.mockResolvedValue(0);
      await service.findAll(userId, {
        activeFilter: undefined,
        skip: 0,
        limit: 20,
        page: 1,
      } as any);
      expect(prisma.recurringDelivery.findMany.mock.calls[0][0].where).toEqual({
        userId,
      });
    });
  });

  describe('owner-scoping', () => {
    it('findOne throws NotFound when not owned', async () => {
      prisma.recurringDelivery.findFirst.mockResolvedValue(null);
      await expect(service.findOne(userId, 'r-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('pause throws NotFound when not owned (count 0)', async () => {
      prisma.recurringDelivery.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.pause(userId, 'r-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('remove throws NotFound when not owned (count 0)', async () => {
      prisma.recurringDelivery.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.remove(userId, 'r-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('pause / resume', () => {
    const ownedRow = {
      id: 'r-1',
      userId,
      freq: 'DAILY',
      daysOfWeek: [],
      timeOfDay: '08:00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      active: true,
    };

    it('pause sets active=false without touching nextRunAt', async () => {
      prisma.recurringDelivery.updateMany.mockResolvedValue({ count: 1 });
      prisma.recurringDelivery.findFirst.mockResolvedValue({
        ...ownedRow,
        active: false,
      });
      await service.pause(userId, 'r-1');
      expect(prisma.recurringDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-1', userId },
        data: { active: false },
      });
    });

    it('resume recomputes nextRunAt from now', async () => {
      prisma.recurringDelivery.findFirst.mockResolvedValue(ownedRow);
      prisma.recurringDelivery.updateMany.mockResolvedValue({ count: 1 });
      await service.resume(userId, 'r-1');
      const call = prisma.recurringDelivery.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'r-1', userId });
      expect(call.data.active).toBe(true);
      expect(call.data.nextRunAt).toBeInstanceOf(Date);
    });

    it('resume rejects a recurrence that has already ended', async () => {
      prisma.recurringDelivery.findFirst.mockResolvedValue({
        ...ownedRow,
        endDate: new Date('2020-01-01T00:00:00.000Z'),
      });
      await expect(service.resume(userId, 'r-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
