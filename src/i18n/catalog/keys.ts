/**
 * Catalog keys that aren't discoverable from a code enum/list (unlike STAGES /
 * DeliveryFailureReason / FAQS). The completeness spec iterates these so every locale is
 * required to define them; the validation factory emits exactly the VALIDATION_KEYS set
 * (one per class-validator constraint it maps), so this is the single source of truth that
 * keeps the factory and the catalog in lockstep.
 */
export const VALIDATION_KEYS = [
  'validation.isString',
  'validation.isNotEmpty',
  'validation.isNumber',
  'validation.isInt',
  'validation.isBoolean',
  'validation.isArray',
  'validation.isEmail',
  'validation.isPositive',
  'validation.isEnum',
  'validation.isIn',
  'validation.min',
  'validation.max',
  'validation.minLength',
  'validation.maxLength',
  'validation.isLength',
  'validation.arrayMinSize',
  'validation.arrayMaxSize',
  'validation.matches',
  'validation.isDateString',
  'validation.isISO8601',
  'validation.whitelistValidation',
  'validation.invalid',
  'validation.code.sixDigit',
  'validation.timeOfDay.format',
] as const;
