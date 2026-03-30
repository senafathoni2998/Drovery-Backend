import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { WORKFLOWS, Workflow } from './data';
import { CompleteStepDto } from './dto';

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  getWorkflow(workflowId: string): Workflow {
    const workflow = WORKFLOWS[workflowId];

    if (!workflow) {
      throw new NotFoundException(`Workflow "${workflowId}" not found`);
    }

    return workflow;
  }

  getAll(): Workflow[] {
    return Object.values(WORKFLOWS);
  }

  async completeStep(deliveryId: string, dto: CompleteStepDto) {
    const workflow = WORKFLOWS[dto.workflowId];

    if (!workflow) {
      throw new NotFoundException(`Workflow "${dto.workflowId}" not found`);
    }

    const stepExists = workflow.steps.some((step) => step.id === dto.stepId);

    if (!stepExists) {
      throw new BadRequestException(
        `Step "${dto.stepId}" does not exist in workflow "${dto.workflowId}"`,
      );
    }

    return this.prisma.workflowStepCompletion.upsert({
      where: {
        deliveryId_workflowId_stepId: {
          deliveryId,
          workflowId: dto.workflowId,
          stepId: dto.stepId,
        },
      },
      update: {
        completedAt: new Date(),
      },
      create: {
        deliveryId,
        workflowId: dto.workflowId,
        stepId: dto.stepId,
      },
    });
  }

  async getCompletedSteps(deliveryId: string, workflowId: string) {
    return this.prisma.workflowStepCompletion.findMany({
      where: { deliveryId, workflowId },
      orderBy: { completedAt: 'asc' },
    });
  }

  generateQrPayload(deliveryId: string): string {
    return JSON.stringify({
      deliveryId,
      timestamp: Date.now(),
    });
  }

  validateQrPayload(payload: string): {
    valid: boolean;
    deliveryId?: string;
  } {
    try {
      const parsed = JSON.parse(payload);

      if (!parsed.deliveryId || !parsed.timestamp) {
        return { valid: false };
      }

      return { valid: true, deliveryId: parsed.deliveryId };
    } catch {
      return { valid: false };
    }
  }
}
