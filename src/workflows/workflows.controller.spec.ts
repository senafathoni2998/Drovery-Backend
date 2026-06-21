import { Test, TestingModule } from '@nestjs/testing';

import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

describe('WorkflowsController', () => {
  let controller: WorkflowsController;
  let workflowsService: {
    getAll: jest.Mock;
    getWorkflow: jest.Mock;
    completeStep: jest.Mock;
    getCompletedSteps: jest.Mock;
    generateQrPayload: jest.Mock;
    validateQrPayload: jest.Mock;
  };

  const mockWorkflow = { id: 'load-package', title: 'Load Package', steps: [] };

  beforeEach(async () => {
    workflowsService = {
      getAll: jest.fn().mockReturnValue([mockWorkflow]),
      getWorkflow: jest.fn().mockReturnValue(mockWorkflow),
      completeStep: jest.fn().mockResolvedValue({ id: 'c-1', stepId: 's-1' }),
      getCompletedSteps: jest.fn().mockResolvedValue([]),
      generateQrPayload: jest
        .fn()
        .mockReturnValue('{"deliveryId":"d-1","timestamp":123}'),
      validateQrPayload: jest
        .fn()
        .mockReturnValue({ valid: true, deliveryId: 'd-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [{ provide: WorkflowsService, useValue: workflowsService }],
    }).compile();

    controller = module.get<WorkflowsController>(WorkflowsController);
  });

  describe('getAll', () => {
    it('should delegate to workflowsService.getAll', () => {
      const result = controller.getAll();

      expect(workflowsService.getAll).toHaveBeenCalled();
      expect(result).toEqual([mockWorkflow]);
    });
  });

  describe('getWorkflow', () => {
    it('should delegate to workflowsService.getWorkflow', () => {
      const result = controller.getWorkflow('load-package');

      expect(workflowsService.getWorkflow).toHaveBeenCalledWith('load-package');
      expect(result).toEqual(mockWorkflow);
    });
  });

  describe('completeStep', () => {
    it('should delegate to workflowsService.completeStep', async () => {
      const dto = { workflowId: 'load-package', stepId: 's-1' };

      const result = await controller.completeStep('d-1', dto);

      expect(workflowsService.completeStep).toHaveBeenCalledWith('d-1', dto);
      expect(result.stepId).toBe('s-1');
    });
  });

  describe('getCompletedSteps', () => {
    it('should delegate to workflowsService.getCompletedSteps', async () => {
      const result = await controller.getCompletedSteps('d-1', 'load-package');

      expect(workflowsService.getCompletedSteps).toHaveBeenCalledWith(
        'd-1',
        'load-package',
      );
      expect(result).toEqual([]);
    });
  });

  describe('generateQrPayload', () => {
    it('should return wrapped payload', () => {
      const result = controller.generateQrPayload('d-1');

      expect(workflowsService.generateQrPayload).toHaveBeenCalledWith('d-1');
      expect(result).toEqual({
        payload: '{"deliveryId":"d-1","timestamp":123}',
      });
    });
  });

  describe('validateQrPayload', () => {
    it('should delegate to workflowsService.validateQrPayload', () => {
      const result = controller.validateQrPayload(
        '{"deliveryId":"d-1","timestamp":123}',
      );

      expect(workflowsService.validateQrPayload).toHaveBeenCalledWith(
        '{"deliveryId":"d-1","timestamp":123}',
      );
      expect(result).toEqual({ valid: true, deliveryId: 'd-1' });
    });
  });
});
