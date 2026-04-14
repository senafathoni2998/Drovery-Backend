import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { WorkflowsService } from './workflows.service';
import { PrismaService } from '../prisma/prisma.service';
import { WORKFLOWS } from './data';
import { createMockPrismaService } from '../test/prisma-mock';

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorkflowsService>(WorkflowsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getWorkflow', () => {
    it('should return a workflow by ID', () => {
      const workflowIds = Object.keys(WORKFLOWS);
      const result = service.getWorkflow(workflowIds[0]);

      expect(result).toEqual(WORKFLOWS[workflowIds[0]]);
    });

    it('should throw NotFoundException for unknown workflow', () => {
      expect(() => service.getWorkflow('nonexistent')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAll', () => {
    it('should return all workflows', () => {
      const result = service.getAll();

      expect(result).toEqual(Object.values(WORKFLOWS));
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('completeStep', () => {
    it('should upsert a workflow step completion', async () => {
      const workflowId = Object.keys(WORKFLOWS)[0];
      const stepId = WORKFLOWS[workflowId].steps[0].id;
      prisma.workflowStepCompletion.upsert.mockResolvedValue({
        id: 'completion-1',
        deliveryId: 'delivery-1',
        workflowId,
        stepId,
        completedAt: new Date(),
      });

      const result = await service.completeStep('delivery-1', {
        workflowId,
        stepId,
      });

      expect(result.workflowId).toBe(workflowId);
      expect(prisma.workflowStepCompletion.upsert).toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown workflow', async () => {
      await expect(
        service.completeStep('delivery-1', {
          workflowId: 'nonexistent',
          stepId: 'step-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for unknown step', async () => {
      const workflowId = Object.keys(WORKFLOWS)[0];

      await expect(
        service.completeStep('delivery-1', {
          workflowId,
          stepId: 'nonexistent-step',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCompletedSteps', () => {
    it('should return completed steps for a delivery workflow', async () => {
      const mockSteps = [
        { id: 'c-1', deliveryId: 'd-1', workflowId: 'w-1', stepId: 's-1' },
      ];
      prisma.workflowStepCompletion.findMany.mockResolvedValue(mockSteps);

      const result = await service.getCompletedSteps('d-1', 'w-1');

      expect(result).toEqual(mockSteps);
      expect(prisma.workflowStepCompletion.findMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1', workflowId: 'w-1' },
        orderBy: { completedAt: 'asc' },
      });
    });
  });

  describe('generateQrPayload', () => {
    it('should return JSON string with deliveryId and timestamp', () => {
      const result = service.generateQrPayload('delivery-1');
      const parsed = JSON.parse(result);

      expect(parsed.deliveryId).toBe('delivery-1');
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('validateQrPayload', () => {
    it('should return valid for correct payload', () => {
      const payload = JSON.stringify({
        deliveryId: 'delivery-1',
        timestamp: Date.now(),
      });

      const result = service.validateQrPayload(payload);

      expect(result).toEqual({ valid: true, deliveryId: 'delivery-1' });
    });

    it('should return invalid for payload missing fields', () => {
      const payload = JSON.stringify({ deliveryId: 'delivery-1' });

      const result = service.validateQrPayload(payload);

      expect(result).toEqual({ valid: false });
    });

    it('should return invalid for malformed JSON', () => {
      const result = service.validateQrPayload('not-json');

      expect(result).toEqual({ valid: false });
    });
  });
});
