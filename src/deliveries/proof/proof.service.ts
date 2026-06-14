import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { SubmitProofDto } from './dto/submit-proof.dto';

@Injectable()
export class ProofService {
  private readonly logger = new Logger(ProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Auto-creates a proof when a delivery is delivered (called by the simulation).
   * Idempotent: returns the existing proof if one was already recorded.
   */
  async createAutoProof(
    deliveryId: string,
    opts: { lat?: number; lng?: number; recipientName?: string | null },
  ) {
    const existing = await this.prisma.proofOfDelivery.findUnique({
      where: { deliveryId },
    });
    if (existing) return existing;

    const photoUrl = await this.storage.storePodImage(deliveryId, null);

    const proof = await this.prisma.proofOfDelivery.create({
      data: {
        deliveryId,
        photoUrl,
        lat: opts.lat ?? null,
        lng: opts.lng ?? null,
        recipientName: opts.recipientName ?? null,
      },
    });

    this.logger.log(`Proof of delivery recorded for ${deliveryId}`);
    return proof;
  }

  /**
   * Owner-submitted proof (e.g. recipient confirms receipt with a photo).
   * Upserts so a real photo can replace the auto-generated placeholder.
   */
  async submitProof(userId: string, deliveryId: string, dto: SubmitProofDto) {
    const delivery = await this.requireOwnedDelivery(userId, deliveryId);

    const photoUrl = await this.storage.storePodImage(
      deliveryId,
      dto.photoBase64 ?? null,
    );

    const data = {
      photoUrl,
      recipientName: dto.recipientName ?? delivery.receiver,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      notes: dto.notes ?? null,
    };

    return this.prisma.proofOfDelivery.upsert({
      where: { deliveryId },
      update: data,
      create: { deliveryId, ...data },
    });
  }

  async getProof(userId: string, deliveryId: string) {
    await this.requireOwnedDelivery(userId, deliveryId);

    const proof = await this.prisma.proofOfDelivery.findUnique({
      where: { deliveryId },
    });
    if (!proof) {
      throw new NotFoundException(
        `No proof of delivery for delivery "${deliveryId}"`,
      );
    }
    return proof;
  }

  private async requireOwnedDelivery(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.userId !== userId) {
      throw new NotFoundException(`Delivery with id "${deliveryId}" not found`);
    }
    return delivery;
  }
}
