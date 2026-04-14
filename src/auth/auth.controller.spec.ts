import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    login: jest.Mock;
    refreshTokens: jest.Mock;
  };

  const mockAuthResult = {
    user: { id: 'user-1', email: 'john@test.com', name: 'John' },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(async () => {
    authService = {
      signup: jest.fn().mockResolvedValue(mockAuthResult),
      login: jest.fn().mockResolvedValue(mockAuthResult),
      refreshTokens: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('signup', () => {
    it('should delegate to authService.signup', async () => {
      const dto = { name: 'John', email: 'john@test.com', password: 'pass123' };

      const result = await controller.signup(dto);

      expect(authService.signup).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockAuthResult);
    });
  });

  describe('login', () => {
    it('should delegate to authService.login', async () => {
      const dto = { email: 'john@test.com', password: 'pass123' };

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockAuthResult);
    });
  });

  describe('refresh', () => {
    it('should delegate to authService.refreshTokens', async () => {
      const result = await controller.refresh(
        { refreshToken: 'old-token' },
        { sub: 'user-1', email: 'john@test.com' },
      );

      expect(authService.refreshTokens).toHaveBeenCalledWith('user-1');
      expect(result.accessToken).toBe('new-access');
    });
  });
});
