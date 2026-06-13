import { IsIn, IsOptional, IsString } from 'class-validator';

import { SUPPORTED_LOCALES } from '../../i18n/catalog';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  // Preferred language for server-emitted content (notifications/emails/support).
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: string;
}
