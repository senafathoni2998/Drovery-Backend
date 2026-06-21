import { BadRequestException } from '@nestjs/common';
import { ValidationError, getMetadataStorage } from 'class-validator';

/**
 * A locale-AGNOSTIC ValidationPipe exceptionFactory: it maps each class-validator
 * constraint to a stable catalog key (`validation.<constraint>`) + params, and emits a
 * structured body (`i18nValidationErrors`) that AllExceptionsFilter translates with the
 * request locale. One factory covers all ~351 decorators across the 32 input DTOs — no
 * per-decorator `message:` and nothing to re-edit for a new DTO.
 *
 * The property name is interpolated RAW ({property}) — it is the wire-contract field id the
 * mobile app maps to a form field; localizing it would break that association. There are no
 * @ValidateNested DTOs, so the error tree is flat (no children recursion). Numeric/list args
 * (minLength's 6, isIn's value list) are NOT on the ValidationError, so they are read from
 * class-validator's metadata storage; a missing arg degrades to a literal {placeholder}
 * (I18nService never throws), never a crash.
 */
export interface I18nValidationError {
  key: string;
  params: Record<string, string | number>;
}

// The constraints actually used across the DTOs (one catalog key each). `whitelistValidation`
// is the forbidNonWhitelisted "should not exist" error; `isEnum`/`isIn` carry a value list.
const KNOWN_CONSTRAINTS = new Set([
  'isString',
  'isNotEmpty',
  'isNumber',
  'isInt',
  'isBoolean',
  'isArray',
  'isEmail',
  'isPositive',
  'isEnum',
  'isIn',
  'min',
  'max',
  'minLength',
  'maxLength',
  'isLength',
  'arrayMinSize',
  'arrayMaxSize',
  'matches',
  'isDateString',
  'isISO8601',
  'whitelistValidation',
]);

/** The class-validator constraint args (e.g. [6] for minLength, [['SMALL','LARGE']] for isIn),
 * read from metadata since they are not exposed on the ValidationError. Defensive: any
 * version/shape surprise yields []. */
function constraintArgs(
  target: object | undefined,
  property: string,
  constraintName: string,
): unknown[] {
  if (!target) return [];
  try {
    const metas = getMetadataStorage().getTargetValidationMetadatas(
      target.constructor,
      '',
      false,
      false,
    );
    return (
      metas.find(
        (m) => m.propertyName === property && m.name === constraintName,
      )?.constraints ?? []
    );
  } catch {
    return [];
  }
}

function paramsFor(
  constraintName: string,
  property: string,
  args: unknown[],
): Record<string, string | number> {
  const params: Record<string, string | number> = { property };
  const asNum = (i: number): number =>
    typeof args[i] === 'number' ? args[i] : Number(args[i]) || 0;
  const prim = (x: unknown): string =>
    typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
      ? String(x)
      : '';
  const asList = (v: unknown): string =>
    Array.isArray(v) ? v.map(prim).filter(Boolean).join(', ') : prim(v);
  switch (constraintName) {
    case 'minLength':
    case 'arrayMinSize':
    case 'min':
      params.min = asNum(0);
      break;
    case 'maxLength':
    case 'arrayMaxSize':
    case 'max':
      params.max = asNum(0);
      break;
    case 'isLength':
      params.min = asNum(0);
      params.max = asNum(1);
      break;
    case 'isIn':
      params.values = asList(args[0]);
      break;
    case 'isEnum':
      // @IsEnum stores [enumObject, name]; surface the value list (numeric reverse-maps stripped).
      params.values =
        args[0] && typeof args[0] === 'object'
          ? Object.values(args[0] as Record<string, unknown>)
              .filter((v) => typeof v === 'string')
              .join(', ')
          : '';
      break;
  }
  return params;
}

/** Resolve the catalog key for an error's first constraint. The two DTOs with a custom
 * @Matches message (code, timeOfDay) get dedicated keys so the localized text is meaningful
 * (a bare `validation.matches` regex carries no human meaning). */
function keyFor(constraintName: string, property: string): string {
  if (constraintName === 'matches') {
    if (property === 'code') return 'validation.code.sixDigit';
    if (property === 'timeOfDay') return 'validation.timeOfDay.format';
  }
  return KNOWN_CONSTRAINTS.has(constraintName)
    ? `validation.${constraintName}`
    : 'validation.invalid';
}

export function i18nValidationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const i18nValidationErrors: I18nValidationError[] = [];
  for (const error of errors) {
    if (!error.constraints) continue;
    // `each: true` and multi-constraint nodes surface on the same node; take the first.
    const constraintName = Object.keys(error.constraints)[0];
    i18nValidationErrors.push({
      key: keyFor(constraintName, error.property),
      params: paramsFor(
        constraintName,
        error.property,
        constraintArgs(error.target, error.property, constraintName),
      ),
    });
  }
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    i18nValidationErrors,
  });
}
