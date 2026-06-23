import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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
    const workflowId = Object.keys(WORKFLOWS)[0];
    const stepId = WORKFLOWS[Object.keys(WORKFLOWS)[0]].steps[0].id;

    it('should upsert a workflow step completion for the OWNER', async () => {
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'u-1',
      });
      prisma.workflowStepCompletion.upsert.mockResolvedValue({
        id: 'completion-1',
        deliveryId: 'delivery-1',
        workflowId,
        stepId,
        completedAt: new Date(),
      });

      const result = await service.completeStep('u-1', 'delivery-1', {
        workflowId,
        stepId,
      });

      expect(result.workflowId).toBe(workflowId);
      expect(prisma.workflowStepCompletion.upsert).toHaveBeenCalled();
    });

    it('throws NotFoundException (no write) when the delivery is owned by someone else (IDOR guard)', async () => {
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'someone-else',
      });

      await expect(
        service.completeStep('u-1', 'delivery-1', { workflowId, stepId }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.workflowStepCompletion.upsert).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown workflow', async () => {
      await expect(
        service.completeStep('u-1', 'delivery-1', {
          workflowId: 'nonexistent',
          stepId: 'step-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for unknown step', async () => {
      await expect(
        service.completeStep('u-1', 'delivery-1', {
          workflowId,
          stepId: 'nonexistent-step',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCompletedSteps', () => {
    it('should return completed steps for the OWNER', async () => {
      const mockSteps = [
        { id: 'c-1', deliveryId: 'd-1', workflowId: 'w-1', stepId: 's-1' },
      ];
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'u-1',
      });
      prisma.workflowStepCompletion.findMany.mockResolvedValue(mockSteps);

      const result = await service.getCompletedSteps('u-1', 'd-1', 'w-1');

      expect(result).toEqual(mockSteps);
      expect(prisma.workflowStepCompletion.findMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1', workflowId: 'w-1' },
        orderBy: { completedAt: 'asc' },
      });
    });

    it('throws NotFoundException (no read) when the delivery is not the caller’s (IDOR guard)', async () => {
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'someone-else',
      });

      await expect(
        service.getCompletedSteps('u-1', 'd-1', 'w-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.workflowStepCompletion.findMany).not.toHaveBeenCalled();
    });
  });

  describe('generateQrPayload', () => {
    beforeEach(() => {
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'u-1',
      });
    });

    it('should return a signed JSON string for the OWNER', async () => {
      const result = await service.generateQrPayload('u-1', 'delivery-1');
      const parsed = JSON.parse(result);

      expect(parsed.deliveryId).toBe('delivery-1');
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.sig).toBeDefined();
    });

    it('throws NotFoundException when minting a QR for a non-owned delivery (IDOR guard)', async () => {
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'someone-else',
      });

      await expect(
        service.generateQrPayload('u-1', 'delivery-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateQrPayload', () => {
    // validateQrPayload is an owner-agnostic signature/TTL check; mint owned payloads to test it.
    beforeEach(() => {
      prisma.delivery.findFirst.mockResolvedValue({
        createdAt: new Date(),
        userId: 'u-1',
      });
    });

    it('should return valid for a freshly generated (signed) payload', async () => {
      const payload = await service.generateQrPayload('u-1', 'delivery-1');

      const result = service.validateQrPayload(payload);

      expect(result).toEqual({ valid: true, deliveryId: 'delivery-1' });
    });

    it('should reject an unsigned payload missing fields', () => {
      const payload = JSON.stringify({ deliveryId: 'delivery-1' });

      const result = service.validateQrPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('malformed');
    });

    it('should reject a payload with a tampered signature', () => {
      const payload = JSON.stringify({
        deliveryId: 'delivery-1',
        timestamp: Date.now(),
        sig: 'deadbeef',
      });

      const result = service.validateQrPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('bad_signature');
    });

    it('should reject a tampered deliveryId (signature no longer matches)', async () => {
      const payload = JSON.parse(
        await service.generateQrPayload('u-1', 'delivery-1'),
      );
      payload.deliveryId = 'delivery-HACKED';

      const result = service.validateQrPayload(JSON.stringify(payload));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('bad_signature');
    });

    it('should reject an expired QR payload', async () => {
      const payload = await service.generateQrPayload('u-1', 'delivery-1');
      const realNow = Date.now();
      const spy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(realNow + 6 * 60 * 1000);

      const result = service.validateQrPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
      spy.mockRestore();
    });

    it('should return invalid for malformed JSON', () => {
      const result = service.validateQrPayload('not-json');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('malformed');
    });
  });
});
