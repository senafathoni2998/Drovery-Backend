import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SavedAddressesService } from './saved-addresses.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('SavedAddressesService', () => {
  let service: SavedAddressesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let geo: { geocode: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    geo = { geocode: jest.fn().mockResolvedValue({ lat: 1, lng: 2 }) };
    service = new SavedAddressesService(prisma as any, geo as any);
  });

  describe('create', () => {
    it('geocodes the address and makes the FIRST one the default (atomic)', async () => {
      prisma.savedAddress.count.mockResolvedValue(0);
      prisma.savedAddress.create.mockResolvedValue({
        id: 'a1',
        isDefault: true,
      });

      await service.create('u1', { label: 'Home', address: 'Jl X' });

      expect(geo.geocode).toHaveBeenCalledWith('Jl X');
      // clears any prior default in the same $transaction as the create
      expect(prisma.savedAddress.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.savedAddress.create.mock.calls[0][0].data).toMatchObject({
        userId: 'u1',
        label: 'Home',
        address: 'Jl X',
        lat: 1,
        lng: 2,
        isDefault: true,
      });
    });

    it('uses supplied coords (no geocode) and is non-default when not first', async () => {
      prisma.savedAddress.count.mockResolvedValue(2);
      prisma.savedAddress.create.mockResolvedValue({});

      await service.create('u1', {
        label: 'W',
        address: 'Jl Y',
        lat: 5,
        lng: 6,
      });

      expect(geo.geocode).not.toHaveBeenCalled();
      expect(prisma.savedAddress.updateMany).not.toHaveBeenCalled();
      expect(prisma.savedAddress.create.mock.calls[0][0].data).toMatchObject({
        lat: 5,
        lng: 6,
        isDefault: false,
      });
    });

    it('leaves coords null when geocoding fails (best-effort)', async () => {
      prisma.savedAddress.count.mockResolvedValue(1);
      geo.geocode.mockResolvedValue(null);
      prisma.savedAddress.create.mockResolvedValue({});

      await service.create('u1', { label: 'X', address: 'Nowhere' });

      expect(prisma.savedAddress.create.mock.calls[0][0].data).toMatchObject({
        lat: null,
        lng: null,
      });
    });

    it('rejects past the per-user cap (20)', async () => {
      prisma.savedAddress.count.mockResolvedValue(20);
      await expect(
        service.create('u1', { label: 'X', address: 'Y' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll / findOne ownership', () => {
    it('lists with default first', async () => {
      prisma.savedAddress.findMany.mockResolvedValue([]);
      await service.findAll('u1');
      expect(prisma.savedAddress.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
    });

    it('throws 404 for a missing or foreign address', async () => {
      prisma.savedAddress.findUnique.mockResolvedValue(null);
      await expect(service.findOne('u1', 'a1')).rejects.toThrow(
        NotFoundException,
      );
      prisma.savedAddress.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'other',
      });
      await expect(service.findOne('u1', 'a1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setDefault / update / remove', () => {
    it('setDefault atomically clears the prior default', async () => {
      prisma.savedAddress.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
      });
      prisma.savedAddress.update.mockResolvedValue({ id: 'a1' });

      await service.setDefault('u1', 'a1');

      expect(prisma.savedAddress.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isDefault: true, id: { not: 'a1' } },
        data: { isDefault: false },
      });
      expect(prisma.savedAddress.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isDefault: true },
      });
    });

    it('re-geocodes on an address change', async () => {
      prisma.savedAddress.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        address: 'old',
      });
      geo.geocode.mockResolvedValue({ lat: 9, lng: 8 });
      prisma.savedAddress.update.mockResolvedValue({});

      await service.update('u1', 'a1', { address: 'new place' });

      expect(geo.geocode).toHaveBeenCalledWith('new place');
      expect(prisma.savedAddress.update.mock.calls[0][0].data).toMatchObject({
        address: 'new place',
        lat: 9,
        lng: 8,
      });
    });

    it('remove deletes after ownership check and returns success', async () => {
      prisma.savedAddress.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
      });
      prisma.savedAddress.delete.mockResolvedValue({});
      expect(await service.remove('u1', 'a1')).toEqual({ success: true });
      expect(prisma.savedAddress.delete).toHaveBeenCalledWith({
        where: { id: 'a1' },
      });
    });

    it('remove throws 404 for a foreign address (no delete)', async () => {
      prisma.savedAddress.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'other',
      });
      await expect(service.remove('u1', 'a1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.savedAddress.delete).not.toHaveBeenCalled();
    });
  });

  describe('getRecent (from delivery history)', () => {
    it('dedupes by coordinates, newest first, capped', async () => {
      prisma.delivery.findMany.mockResolvedValue([
        {
          fromAddress: 'A',
          fromLat: 1,
          fromLng: 2,
          toAddress: 'B',
          toLat: 3,
          toLng: 4,
          createdAt: new Date('2026-01-02'),
        },
        {
          fromAddress: 'A',
          fromLat: 1,
          fromLng: 2, // same coords as above → deduped
          toAddress: 'C',
          toLat: 5,
          toLng: 6,
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const recents = await service.getRecent('u1');
      expect(recents.map((r) => r.address)).toEqual(['A', 'B', 'C']);
      expect(recents[0]).toMatchObject({ address: 'A', type: 'from' });
    });

    it('returns [] for an empty history', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      expect(await service.getRecent('u1')).toEqual([]);
    });
  });
});
