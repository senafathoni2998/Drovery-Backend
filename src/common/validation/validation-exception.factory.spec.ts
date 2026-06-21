import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

import {
  I18nValidationError,
  i18nValidationExceptionFactory,
} from './validation-exception.factory';

class TestDto {
  @IsEmail()
  email!: string;

  @MinLength(6)
  password!: string;

  @IsIn(['SMALL', 'LARGE'])
  size!: string;

  @IsNotEmpty()
  name!: string;

  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;
}

describe('i18nValidationExceptionFactory', () => {
  const keyedFor = (
    over: Partial<TestDto>,
  ): Record<string, I18nValidationError> => {
    const errors = validateSync(Object.assign(new TestDto(), over));
    const res = i18nValidationExceptionFactory(errors).getResponse() as {
      i18nValidationErrors: I18nValidationError[];
    };
    return Object.fromEntries(
      res.i18nValidationErrors.map((e) => [e.params.property, e]),
    );
  };

  it('maps each constraint to validation.<constraint> and keeps the raw property name', () => {
    const by = keyedFor({
      email: 'not-an-email',
      password: 'abc',
      size: 'XL',
      name: '',
      code: '12',
    });
    expect(by.email.key).toBe('validation.isEmail');
    expect(by.password.key).toBe('validation.minLength');
    expect(by.size.key).toBe('validation.isIn');
    expect(by.name.key).toBe('validation.isNotEmpty');
  });

  it('extracts numeric/list params from class-validator metadata', () => {
    const by = keyedFor({ password: 'abc', size: 'XL' });
    expect(by.password.params.min).toBe(6);
    expect(by.size.params.values).toBe('SMALL, LARGE');
  });

  it('gives the custom @Matches(code) DTO a dedicated key (not bare validation.matches)', () => {
    const by = keyedFor({ code: '12' });
    expect(by.code.key).toBe('validation.code.sixDigit');
  });

  it('returns a 400 carrying the structured i18nValidationErrors', () => {
    const res = i18nValidationExceptionFactory(
      validateSync(new TestDto()),
    ).getResponse() as { statusCode: number; i18nValidationErrors: unknown[] };
    expect(res.statusCode).toBe(400);
    expect(Array.isArray(res.i18nValidationErrors)).toBe(true);
    expect(res.i18nValidationErrors.length).toBeGreaterThan(0);
  });
});
