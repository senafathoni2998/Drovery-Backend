import { ApiProperty } from '@nestjs/swagger';

import { PromoRejectReason } from '../promo.types';

// Discriminated union PromoPreview has two branches (valid: true | false).
// OpenAPI does not natively support runtime-discriminated unions, so we model
// both branches as a single flat DTO with optional fields — the `valid` flag
// tells the client which fields will be present.

export class PromoValidateResponseDto {
  /** Whether the promo code passed all validation checks. */
  valid: boolean;

  // ── valid: true fields ────────────────────────────────────────────────────

  /** The normalised promo code string (present when valid = true). */
  code?: string | null;

  /** Discount calculation method (present when valid = true). */
  @ApiProperty({
    enum: ['PERCENT', 'FIXED'],
    required: false,
    nullable: true,
    description: 'Discount type — PERCENT or FIXED amount.',
  })
  discountType?: 'PERCENT' | 'FIXED' | null;

  /** Computed discount amount off the order total (present when valid = true). */
  discountAmount?: number | null;

  /** The original order total that was passed in (present when valid = true). */
  originalTotal?: number | null;

  /** The order total after discount (present when valid = true). */
  finalTotal?: number | null;

  // ── valid: false fields ───────────────────────────────────────────────────

  /** Machine-readable rejection reason (present when valid = false). */
  @ApiProperty({
    enum: [
      'INVALID',
      'INACTIVE',
      'NOT_STARTED',
      'EXPIRED',
      'GLOBALLY_MAXED',
      'PER_USER_EXCEEDED',
      'MIN_NOT_MET',
    ] satisfies PromoRejectReason[],
    required: false,
    nullable: true,
    description: 'Why the code was rejected (only set when valid = false).',
  })
  reason?: PromoRejectReason | null;

  /** Human-readable rejection message (present when valid = false). */
  message?: string | null;
}
