import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/exceptions/app-exception';
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
      throw new AppNotFoundException('error.workflow.not_found', {
        workflowId,
      });
    }

    return workflow;
  }

  getAll(): Workflow[] {
    return Object.values(WORKFLOWS);
  }

  /**
   * Resolve a delivery the CALLER OWNS, returning the parent createdAt needed for child
   * writes (deliveries is partitioned, so id alone is not a unique-where). 404s — not 403s —
   * a missing OR non-owned id, mirroring DeliveriesService.findOne, so a delivery's workflow
   * can only be read/mutated by its owner (the steps/QR endpoints are otherwise just
   * JwtAuthGuard-authenticated and the deliveryId is a non-secret, owner-visible uuid).
   */
  private async assertOwnedDelivery(
    deliveryId: string,
    userId: string,
  ): Promise<{ createdAt: Date }> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { createdAt: true, userId: true },
    });
    if (!delivery || delivery.userId !== userId) {
      throw new AppNotFoundException('error.delivery.not_found', {
        id: deliveryId,
      });
    }
    return { createdAt: delivery.createdAt };
  }

  async completeStep(userId: string, deliveryId: string, dto: CompleteStepDto) {
    const workflow = WORKFLOWS[dto.workflowId];

    if (!workflow) {
      throw new AppNotFoundException('error.workflow.not_found', {
        workflowId: dto.workflowId,
      });
    }

    const stepExists = workflow.steps.some((step) => step.id === dto.stepId);

    if (!stepExists) {
      throw new AppBadRequestException('error.workflow.step_not_found', {
        stepId: dto.stepId,
        workflowId: dto.workflowId,
      });
    }

    // Owner-scoped: only the delivery's owner may record its workflow steps.
    const { createdAt } = await this.assertOwnedDelivery(deliveryId, userId);

    return this.prisma.workflowStepCompletion.upsert({
      where: {
        deliveryId_workflowId_stepId_deliveryCreatedAt: {
          deliveryId,
          workflowId: dto.workflowId,
          stepId: dto.stepId,
          deliveryCreatedAt: createdAt,
        },
      },
      update: {
        completedAt: new Date(),
      },
      create: {
        deliveryId,
        deliveryCreatedAt: createdAt,
        workflowId: dto.workflowId,
        stepId: dto.stepId,
      },
    });
  }

  async getCompletedSteps(
    userId: string,
    deliveryId: string,
    workflowId: string,
  ) {
    // Owner-scoped: a user may only read their OWN delivery's step completions.
    await this.assertOwnedDelivery(deliveryId, userId);
    return this.prisma.workflowStepCompletion.findMany({
      where: { deliveryId, workflowId },
      orderBy: { completedAt: 'asc' },
    });
  }

  async generateQrPayload(userId: string, deliveryId: string): Promise<string> {
    // Owner-scoped: only the delivery's owner may mint a signed handoff QR for it.
    await this.assertOwnedDelivery(deliveryId, userId);
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
