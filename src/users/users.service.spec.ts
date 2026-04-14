import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof createMockPrismaService>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
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
      });
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
