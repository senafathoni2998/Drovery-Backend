import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    login: jest.Mock;
    refreshTokens: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
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
      forgotPassword: jest.fn().mockResolvedValue({ success: true }),
      resetPassword: jest.fn().mockResolvedValue({ success: true }),
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

  describe('forgotPassword', () => {
    it('should delegate the email to authService.forgotPassword', async () => {
      const result = await controller.forgotPassword({ email: 'john@test.com' });

      expect(authService.forgotPassword).toHaveBeenCalledWith('john@test.com');
      expect(result).toEqual({ success: true });
    });
  });

  describe('resetPassword', () => {
    it('should delegate token + newPassword to authService.resetPassword', async () => {
      const result = await controller.resetPassword({
        token: 'tok',
        newPassword: 'newpass123',
      });

      expect(authService.resetPassword).toHaveBeenCalledWith('tok', 'newpass123');
      expect(result).toEqual({ success: true });
    });
  });
});
