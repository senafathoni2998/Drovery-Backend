import { Test, TestingModule } from '@nestjs/testing';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    getStats: jest.Mock;
  };

  const mockUser = {
    id: 'user-1',
    email: 'john@test.com',
    name: 'John',
    phone: null,
    address: null,
    bio: null,
    avatarUrl: null,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    usersService = {
      getProfile: jest.fn().mockResolvedValue(mockUser),
      updateProfile: jest.fn().mockResolvedValue(mockUser),
      getStats: jest
        .fn()
        .mockResolvedValue({ total: 10, active: 3, completed: 7 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('getProfile', () => {
    it('should return user profile as UserResponseDto', async () => {
      const result = await controller.getProfile('user-1');

      expect(usersService.getProfile).toHaveBeenCalledWith('user-1');
      expect(result.id).toBe('user-1');
      expect(result.email).toBe('john@test.com');
      expect((result as any).passwordHash).toBeUndefined();
    });
  });

  describe('updateProfile', () => {
    it('should delegate to usersService.updateProfile', async () => {
      const dto = { name: 'John Updated' };

      const result = await controller.updateProfile('user-1', dto);

      expect(usersService.updateProfile).toHaveBeenCalledWith('user-1', dto);
      expect(result.id).toBe('user-1');
    });
  });

  describe('getStats', () => {
    it('should delegate to usersService.getStats', async () => {
      const result = await controller.getStats('user-1');

      expect(usersService.getStats).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ total: 10, active: 3, completed: 7 });
    });
  });
});
