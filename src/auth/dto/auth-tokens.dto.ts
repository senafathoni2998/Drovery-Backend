import { ApiProperty } from '@nestjs/swagger';

/** Minimal user summary returned alongside tokens on login/signup. */
export class AuthUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty()
  name: string;
}

/** The auth session payload: a short-lived access JWT + a rotating refresh token. */
export class AuthTokensDto {
  @ApiProperty({
    description: 'JWT access token — send as `Authorization: Bearer`',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Refresh token — POST /auth/refresh to rotate it for a new pair',
  })
  refreshToken: string;

  @ApiProperty({
    type: AuthUserSummaryDto,
    required: false,
    description: 'Present on login/signup; omitted on refresh',
  })
  user?: AuthUserSummaryDto;
}
