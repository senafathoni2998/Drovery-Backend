import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';

jest.mock('bcrypt');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    jwtService = { signAsync: jest.fn().mockResolvedValue('mock-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                'jwt.secret': 'test-secret',
                'jwt.expiresIn': '15m',
                'jwt.refreshSecret': 'test-refresh-secret',
                'jwt.refreshExpiresIn': '7d',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    const dto = { name: 'John', email: 'john@test.com', password: 'pass123' };

    it('should create a new user and return tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        name: dto.name,
        passwordHash: 'hashed-password',
      });

      const result = await service.signup(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash: 'hashed-password',
        },
      });
      expect(result.user).toEqual({
        id: 'user-1',
        email: dto.email,
        name: dto.name,
      });
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
    });

    it('should throw ConflictException if email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.signup(dto)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto = { email: 'john@test.com', password: 'pass123' };

    it('should return user and tokens on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        name: 'John',
        passwordHash: 'hashed-password',
      });
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.user).toEqual({
        id: 'user-1',
        email: dto.email,
        name: 'John',
      });
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        passwordHash: 'hashed-password',
      });
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshTokens', () => {
    it('should return new tokens for existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
      });

      const result = await service.refreshTokens('user-1');

      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
    });

    it('should throw UnauthorizedException if user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('deleted-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('generateTokens', () => {
    it('should call jwtService.signAsync with correct params', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
      });

      await service.refreshTokens('user-1');

      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'john@test.com' },
        expect.objectContaining({
          secret: 'test-secret',
          expiresIn: '15m',
        }),
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'john@test.com' },
        expect.objectContaining({
          secret: 'test-refresh-secret',
          expiresIn: '7d',
        }),
      );
    });
  });
});
