import { ApiProperty } from '@nestjs/swagger';
import { ReferralStatus, WalletTxnReason, WalletTxnType } from '@prisma/client';

// Response DTOs are documentation contracts for Swagger/OpenAPI (the @nestjs/swagger
// CLI plugin infers each property from its TS type at build). They mirror the shape
// the wallet service actually returns.

export class WalletTransactionDto {
  id: string;
  userId: string;
  @ApiProperty({ enum: WalletTxnType })
  type: WalletTxnType;
  @ApiProperty({ enum: WalletTxnReason })
  reason: WalletTxnReason;
  /** Positive magnitude; sign carried by `type`. */
  amount: number;
  /** Running balance snapshot after this transaction was applied. */
  balanceAfter: number;
  /** Delivery that triggered this transaction (provenance only). */
  deliveryId: string | null;
  /** Referral that triggered this transaction (provenance only). */
  referralId: string | null;
  // idempotencyKey omitted — internal dedup key, not relevant to clients
  createdAt: Date;
}

export class WalletResponseDto {
  /** Current credit balance in the given currency. */
  balance: number;
  currency: string;
  @ApiProperty({ type: [WalletTransactionDto] })
  transactions: WalletTransactionDto[];
  total: number;
  page: number;
  limit: number;
}

export class ReferralItemDto {
  id: string;
  refereeName: string | null;
  @ApiProperty({ enum: ReferralStatus })
  status: ReferralStatus;
  rewardedAt: Date | null;
  createdAt: Date;
}

export class ReferralRewardPerReferralDto {
  /** Credits (USD) minted to the referrer when a referee completes their first delivery. */
  referrer: number;
  /** Credits (USD) minted to the referee when they complete their first delivery. */
  referee: number;
  currency: string;
}

export class ReferralStatsDto {
  total: number;
  pending: number;
  rewarded: number;
}

export class ReferralsResponseDto {
  /** The user's unique referral code to share with others. */
  referralCode: string;
  rewardPerReferral: ReferralRewardPerReferralDto;
  stats: ReferralStatsDto;
  @ApiProperty({ type: [ReferralItemDto] })
  referrals: ReferralItemDto[];
}
