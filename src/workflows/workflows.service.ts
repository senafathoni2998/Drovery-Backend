import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { WORKFLOWS, Workflow } from './data';
import { CompleteStepDto } from './dto';

// HMAC secret for signing QR payloads. Falls back through env vars so it is
// stable per-deployment; override with QR_SECRET in production.
const QR_SECRET =
  process.env.QR_SECRET ?? process.env.JWT_SECRET ?? 'drovery-qr-dev-secret';
// QR codes are short-lived to prevent replay (5 minutes).
const QR_TTL_MS = 5 * 60 * 1000;

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
    const timestamp = Date.now();
    const sig = this.signQr(deliveryId, timestamp);
    return JSON.stringify({ deliveryId, timestamp, sig });
  }

  validateQrPayload(payload: string): {
    valid: boolean;
    deliveryId?: string;
    reason?: 'malformed' | 'bad_signature' | 'expired';
  } {
    let parsed: { deliveryId?: string; timestamp?: number; sig?: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { valid: false, reason: 'malformed' };
    }

    const { deliveryId, timestamp, sig } = parsed;
    if (!deliveryId || !timestamp || !sig) {
      return { valid: false, reason: 'malformed' };
    }

    // Constant-time signature check (mismatched lengths throw → treat as bad sig)
    const expected = this.signQr(deliveryId, timestamp);
    let signatureOk = false;
    try {
      signatureOk = crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected),
      );
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      return { valid: false, reason: 'bad_signature' };
    }

    if (Date.now() - timestamp > QR_TTL_MS) {
      return { valid: false, reason: 'expired' };
    }

    return { valid: true, deliveryId };
  }

  private signQr(deliveryId: string, timestamp: number): string {
    return crypto
      .createHmac('sha256', QR_SECRET)
      .update(`${deliveryId}.${timestamp}`)
      .digest('hex');
  }
}
