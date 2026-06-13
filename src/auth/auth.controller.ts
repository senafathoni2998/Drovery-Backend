import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { parseLocale } from '../i18n/accept-language';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignupDto,
  VerifyEmailDto,
} from './dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

// Tighter limit on auth endpoints (brute-force / abuse protection): 10 / 60s per IP.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  signup(
    @Body() dto: SignupDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    // Best-effort default locale from the browser/app; the user can change it later.
    return this.authService.signup(dto, parseLocale(acceptLanguage));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.authService.refreshTokens(user.sub, dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    // Locale from the header ONLY (anonymous flow — never reveals account existence).
    return this.authService.forgotPassword(dto.email, parseLocale(acceptLanguage));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@CurrentUser('sub') userId: string) {
    return this.authService.resendVerification(userId);
  }
}
