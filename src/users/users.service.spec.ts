import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  const mockUser = {
    id: 'user-1',
    email: 'john@test.com',
    name: 'John',
    phone: null,
    address: null,
    bio: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        omit: { passwordHash: true },
      });
      expect(cache.set).toHaveBeenCalledWith(
        'user:profile:user-1',
        mockUser,
        60,
      );
    });

    it('returns the cached profile without hitting the DB on a cache hit', async () => {
      cache.get.mockResolvedValue({ id: 'user-1', name: 'Cached' });

      const result = await service.getProfile('user-1');

      expect(result).toEqual({ id: 'user-1', name: 'Cached' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    const updateDto = { name: 'John Updated', phone: '+1234567890' };

    it('should update and return user profile', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, ...updateDto });

      const result = await service.updateProfile('user-1', updateDto);

      expect(result.name).toBe('John Updated');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: updateDto,
      });
      // The cached profile is invalidated so the next GET /users/me is fresh.
      expect(cache.del).toHaveBeenCalledWith('user:profile:user-1');
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('nonexistent', updateDto),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return delivery stats for user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.delivery.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3) // active
        .mockResolvedValueOnce(7); // completed

      const result = await service.getStats('user-1');

      expect(result).toEqual({ total: 10, active: 3, completed: 7 });
      expect(prisma.delivery.count).toHaveBeenCalledTimes(3);
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getStats('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
