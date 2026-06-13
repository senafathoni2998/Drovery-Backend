import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';

jest.mock('bcrypt');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let jwtService: { signAsync: jest.Mock };
  let mailService: {
    sendPasswordResetEmail: jest.Mock;
    sendVerificationEmail: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    jwtService = { signAsync: jest.fn().mockResolvedValue('mock-token') };
    mailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
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
          referralCode: expect.any(String),
          locale: 'en',
        },
      });
      expect(result.user).toEqual({
        id: 'user-1',
        email: dto.email,
        name: dto.name,
      });
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      // sends a verification email on signup
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        dto.email,
        expect.any(String),
        'en',
      );
    });

    it('links a referral when a valid referralCode is supplied (best-effort)', async () => {
      // 1st findUnique: email availability (null). 2nd: referrer lookup by code.
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'referrer-1', email: 'inviter@test.com' });
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        name: dto.name,
      });

      await service.signup({ ...dto, referralCode: 'abcd2345' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { referralCode: 'ABCD2345' }, // uppercased
      });
      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: { referrerId: 'referrer-1', refereeId: 'user-1', status: 'PENDING' },
      });
    });

    it('does not link or block signup for an unknown referralCode', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: dto.email, name: dto.name });

      const result = await service.signup({ ...dto, referralCode: 'NOPE9999' });

      expect(prisma.referral.create).not.toHaveBeenCalled();
      expect(result.user.id).toBe('user-1');
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
    const validRecord = {
      id: 'rt-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('rotates: validates the stored token, revokes it, and issues a new pair', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(validRecord);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
      });

      const result = await service.refreshTokens('user-1', 'raw-refresh');

      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      // old token revoked (rotation), new token persisted
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('rejects an unknown / revoked / expired / mismatched token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(
        service.refreshTokens('user-1', 'bad'),
      ).rejects.toThrow(UnauthorizedException);

      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validRecord,
        revokedAt: new Date(),
      });
      await expect(
        service.refreshTokens('user-1', 'revoked'),
      ).rejects.toThrow(UnauthorizedException);

      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validRecord,
        userId: 'someone-else',
      });
      await expect(
        service.refreshTokens('user-1', 'stolen'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws if the user no longer exists', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(validRecord);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.refreshTokens('user-1', 'raw-refresh'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the presented refresh token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.logout('raw-refresh');

      expect(result).toEqual({ success: true });
      const arg = prisma.refreshToken.updateMany.mock.calls[0][0];
      expect(arg.where.revokedAt).toBeNull();
      expect(arg.data.revokedAt).toEqual(expect.any(Date));
    });
  });

  describe('generateTokens', () => {
    it('signs access + refresh and persists the refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
      });

      await service.refreshTokens('user-1', 'raw-refresh');

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', email: 'john@test.com' }),
        expect.objectContaining({ secret: 'test-secret', expiresIn: '15m' }),
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', email: 'john@test.com' }),
        expect.objectContaining({
          secret: 'test-refresh-secret',
          expiresIn: '7d',
        }),
      );
      // refresh token persisted (hashed) for later rotation/revocation
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('issues a reset token and emails it when the user exists', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
      });
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue({ id: 'tok-1' });

      const result = await service.forgotPassword('john@test.com');

      expect(result).toEqual({ success: true });
      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      // stores a HASH, not the raw token
      const created = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(created.data.tokenHash).toEqual(expect.any(String));
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'john@test.com',
        expect.any(String),
        'en',
      );
    });

    it('succeeds silently (no token, no email) for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('nobody@test.com');

      expect(result).toEqual({ success: true });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password and consumes the token for a valid token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      const result = await service.resetPassword('raw-token', 'newpass123');

      expect(result).toEqual({ success: true });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('newpass123', 12);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects an unknown token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad', 'newpass123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(
        service.resetPassword('raw', 'newpass123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.resetPassword('raw', 'newpass123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('marks the user verified and consumes the token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.verifyEmail('raw-token');

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects an unknown / expired / used token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('bad')).rejects.toThrow(
        BadRequestException,
      );

      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
      });
      await expect(service.verifyEmail('expired')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resendVerification', () => {
    it('issues a new verification email for an unverified user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
        emailVerified: false,
      });

      const result = await service.resendVerification('user-1');

      expect(result).toEqual({ success: true });
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'john@test.com',
        expect.any(String),
        'en',
      );
    });

    it('is a no-op for an already-verified user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'john@test.com',
        emailVerified: true,
      });

      const result = await service.resendVerification('user-1');

      expect(result).toEqual({ success: true });
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });
});
