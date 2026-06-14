import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { ProofService } from './proof.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { createMockPrismaService } from '../../test/prisma-mock';

describe('ProofService', () => {
  let service: ProofService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let storage: { storePodImage: jest.Mock };

  const userId = 'user-1';

  beforeEach(async () => {
    prisma = createMockPrismaService();
    storage = {
      storePodImage: jest.fn().mockResolvedValue('https://img/pod.jpg'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProofService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<ProofService>(ProofService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createAutoProof', () => {
    it('creates a proof with a placeholder photo + final coords', async () => {
      prisma.proofOfDelivery.findUnique.mockResolvedValue(null);
      prisma.proofOfDelivery.create.mockResolvedValue({ id: 'pod-1' });

      const result = await service.createAutoProof('d-1', {
        lat: -6.9,
        lng: 107.6,
        recipientName: 'Budi',
      });

      expect(storage.storePodImage).toHaveBeenCalledWith('d-1', null);
      expect(prisma.proofOfDelivery.create).toHaveBeenCalledWith({
        data: {
          deliveryId: 'd-1',
          photoUrl: 'https://img/pod.jpg',
          lat: -6.9,
          lng: 107.6,
          recipientName: 'Budi',
        },
      });
      expect(result).toEqual({ id: 'pod-1' });
    });

    it('is idempotent — returns the existing proof', async () => {
      prisma.proofOfDelivery.findUnique.mockResolvedValue({
        id: 'pod-existing',
      });

      const result = await service.createAutoProof('d-1', {});

      expect(prisma.proofOfDelivery.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'pod-existing' });
    });
  });

  describe('submitProof', () => {
    it('upserts the proof with the uploaded photo (recipient defaults to delivery.receiver)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        id: 'd-1',
        userId,
        receiver: 'Rina',
      });
      prisma.proofOfDelivery.upsert.mockResolvedValue({ id: 'pod-1' });

      const result = await service.submitProof(userId, 'd-1', {
        photoBase64: 'abc',
        notes: 'left at door',
      });

      expect(storage.storePodImage).toHaveBeenCalledWith('d-1', 'abc');
      const arg = prisma.proofOfDelivery.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ deliveryId: 'd-1' });
      expect(arg.create.recipientName).toBe('Rina');
      expect(arg.create.notes).toBe('left at door');
      expect(result).toEqual({ id: 'pod-1' });
    });

    it("throws NotFound for another user's delivery", async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        id: 'd-1',
        userId: 'other',
      });

      await expect(service.submitProof(userId, 'd-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getProof', () => {
    it('returns the proof for an owned delivery', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ id: 'd-1', userId });
      prisma.proofOfDelivery.findUnique.mockResolvedValue({ id: 'pod-1' });

      const result = await service.getProof(userId, 'd-1');

      expect(result).toEqual({ id: 'pod-1' });
    });

    it('throws NotFound when no proof exists', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ id: 'd-1', userId });
      prisma.proofOfDelivery.findUnique.mockResolvedValue(null);

      await expect(service.getProof(userId, 'd-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
