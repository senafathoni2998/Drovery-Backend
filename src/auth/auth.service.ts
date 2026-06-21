import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import { Prisma } from '@prisma/client';

import {
  AppBadRequestException,
  AppConflictException,
  AppUnauthorizedException,
} from '../common/exceptions/app-exception';
import { Locale } from '../i18n/catalog';
import { parseLocale } from '../i18n/accept-language';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferralCode } from '../wallet/wallet.constants';
import { LoginDto, SignupDto } from './dto';

const BCRYPT_SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (matches JWT)

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async signup(dto: SignupDto, locale: Locale = 'en') {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new AppConflictException('error.auth.email_taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    // Allocate the new user's own referral code, retrying on the (rare) unique
    // collision. Other create errors (e.g. an email race) bubble up.
    let user: { id: string; email: string; name: string } | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        user = await this.prisma.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            passwordHash,
            referralCode: generateReferralCode(),
            locale,
          },
        });
        break;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          JSON.stringify(
            (e.meta as { target?: unknown })?.target ?? '',
          ).includes('referralCode')
        ) {
          continue; // code collision — regenerate
        }
        throw e;
      }
    }
    if (!user) {
      throw new AppConflictException('error.auth.signup_failed');
    }

    // Link an inbound referral (best-effort — an unknown/self code never blocks
    // signup). The reward fires on this user's first delivery.
    if (dto.referralCode) {
      try {
        const code = dto.referralCode.trim().toUpperCase();
        const referrer = await this.prisma.user.findUnique({
          where: { referralCode: code },
        });
        if (
          referrer &&
          referrer.id !== user.id &&
          referrer.email !== dto.email
        ) {
          await this.prisma.referral.create({
            data: {
              referrerId: referrer.id,
              refereeId: user.id,
              status: 'PENDING',
            },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Referral link failed for ${user.email}: ${(error as Error).message}`,
        );
      }
    }

    // Kick off email verification (best-effort — never block signup on email).
    try {
      await this.issueEmailVerification(user.id, user.email, locale);
    } catch (error) {
      this.logger.warn(
        `Verification email failed for ${user.email}: ${(error as Error).message}`,
      );
    }

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new AppUnauthorizedException('error.auth.invalid_credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new AppUnauthorizedException('error.auth.invalid_credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      ...tokens,
    };
  }

  /**
   * Rotates refresh tokens: validates the presented token against the store
   * (must exist, be owned by the user, and not be revoked/expired), revokes it,
   * and issues a fresh pair. A stolen-but-already-rotated token is rejected.
   */
  async refreshTokens(userId: string, refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });

    if (
      !record ||
      record.revokedAt ||
      record.userId !== userId ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new AppUnauthorizedException('error.auth.refresh_invalid');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppUnauthorizedException('error.auth.user_gone');
    }

    // Revoke the used token (rotation), then issue + persist a new pair.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(user.id, user.email);
  }

  /** Revokes the presented refresh token (real, server-side logout). */
  async logout(refreshToken: string): Promise<{ success: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * Starts a password reset. Always resolves the same way regardless of whether
   * the email exists, to avoid leaking which addresses are registered.
   */
  async forgotPassword(
    email: string,
    locale: Locale = 'en',
  ): Promise<{ success: true }> {
    // locale comes from the request's Accept-Language ONLY — never from the
    // looked-up user — so the response/behavior is identical whether or not the
    // account exists (account-existence non-disclosure is preserved).
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      // Invalidate any outstanding tokens, then issue a fresh one.
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const rawToken = crypto.randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      await this.mail.sendPasswordResetEmail(user.email, rawToken, locale);
    }

    return { success: true };
  }

  /**
   * Completes a password reset given a valid, unused, unexpired token.
   * Consumes the token (and any siblings) so it can't be replayed.
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new AppBadRequestException('error.auth.reset_token_invalid');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ── Email verification ────────────────────────────────────────────────────

  /** Issues a fresh verification token and emails it (invalidating prior ones). */
  private async issueEmailVerification(
    userId: string,
    email: string,
    locale: Locale = 'en',
  ) {
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });

    await this.mail.sendVerificationEmail(email, rawToken, locale);
  }

  async verifyEmail(token: string): Promise<{ success: true }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new AppBadRequestException('error.auth.verify_token_invalid');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  /** Re-sends verification to the authenticated user (no-op if already verified). */
  async resendVerification(userId: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user && !user.emailVerified) {
      // Authenticated → use the user's stored locale.
      await this.issueEmailVerification(
        user.id,
        user.email,
        parseLocale(user.locale),
      );
    }
    return { success: true };
  }

  private async generateTokens(
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // jti makes every token unique, so two tokens issued in the same second
    // (e.g. login then an immediate refresh) don't collide on the stored hash.
    const payload = { sub: userId, email, jti: crypto.randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: this.config.get<string>('jwt.expiresIn') as string,
      } as any),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn') as string,
      } as any),
    ]);

    // Persist the refresh token (hashed) so it can be rotated/revoked.
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }
}
