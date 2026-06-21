import { ApiProperty } from '@nestjs/swagger';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  PaymentStatus,
  TrackingSource,
} from '@prisma/client';

// Response DTOs are documentation contracts for Swagger/OpenAPI (the @nestjs/swagger
// CLI plugin infers each property from its TS type at build). They mirror the shape
// the deliveries service actually returns — minus internal columns a client should
// never depend on (e.g. the handoff code HASH), which are deliberately omitted from
// the documented contract.

export class DeliveryTrackingDto {
  id: string;
  deliveryId: string;
  droneLat: number | null;
  droneLng: number | null;
  droneStatus: string | null;
  /** Encoded route geometry, when available. */
  routeJson: Record<string, unknown> | null;
  eta: Date | null;
  updatedAt: Date;
}

export class PaymentSummaryDto {
  id: string;
  deliveryId: string;
  stripePaymentIntentId: string | null;
  amount: number;
  currency: string;
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;
  createdAt: Date;
}

export class ProofOfDeliveryDto {
  id: string;
  deliveryId: string;
  photoUrl: string;
  recipientName: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  capturedAt: Date;
}

export class DeliveryRatingDto {
  id: string;
  deliveryId: string;
  userId: string;
  /** 1–5 stars. */
  stars: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkflowStepDto {
  id: string;
  deliveryId: string;
  workflowId: string;
  stepId: string;
  completedAt: Date;
}

export class DeliveryResponseDto {
  id: string;
  trackingId: string;
  userId: string;
  @ApiProperty({ enum: DeliveryStatus })
  status: DeliveryStatus;
  @ApiProperty({ enum: TrackingSource })
  trackingSource: TrackingSource;
  /** The drone bound to a LIVE delivery (null for SIMULATED). */
  assignedDroneId: string | null;
  @ApiProperty({ enum: DeliveryFailureReason, nullable: true, required: false })
  failureReason: DeliveryFailureReason | null;

  fromAddress: string;
  toAddress: string;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;

  receiver: string;
  packages: string;
  packageSize: string;
  packageWeight: number;
  packageTypes: string[];

  pickupDate: Date;
  pickupTime: string;
  /** When a scheduled delivery's lifecycle kicks off (null for immediate). */
  scheduledFor: Date | null;
  estimatedDelivery: Date | null;
  estimatedPrice: number;

  /** Set once the recipient confirms the handoff OTP. */
  handoffConfirmedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;

  // Relations — present on the single-delivery reads (findOne / track), absent on
  // list rows.
  tracking?: DeliveryTrackingDto | null;
  payment?: PaymentSummaryDto | null;
  proofOfDelivery?: ProofOfDeliveryDto | null;
  rating?: DeliveryRatingDto | null;
  workflowSteps?: WorkflowStepDto[];
}

export class CreatedDeliveryResponseDto extends DeliveryResponseDto {
  @ApiProperty({
    description:
      'The plaintext 6-digit recipient handoff code — returned EXACTLY ONCE on create and never retrievable again.',
  })
  handoffCode: string;
}

export class PaginatedDeliveriesDto {
  @ApiProperty({ type: [DeliveryResponseDto] })
  items: DeliveryResponseDto[];
  total: number;
  page: number;
  limit: number;
}
