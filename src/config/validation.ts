import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsNumber()
  PORT: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  // In production, refuse to boot with a weak/default JWT secret.
  if (config.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = String(config[key] ?? '');
      if (value.length < 24 || /change|example|xxxx|placeholder/i.test(value)) {
        throw new Error(
          `${key} is weak or a placeholder — set a strong (>=24 char) secret in production`,
        );
      }
    }
  }

  return validated;
}
