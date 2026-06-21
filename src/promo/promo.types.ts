export type PromoRejectReason =
  | 'INVALID'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'GLOBALLY_MAXED'
  | 'PER_USER_EXCEEDED'
  | 'MIN_NOT_MET';

export interface DiscountResult {
  discountAmount: number;
  finalTotal: number;
}

export type PromoPreview =
  | {
      valid: true;
      code: string;
      discountType: 'PERCENT' | 'FIXED';
      discountAmount: number;
      originalTotal: number;
      finalTotal: number;
    }
  | { valid: false; reason: PromoRejectReason; message: string };
