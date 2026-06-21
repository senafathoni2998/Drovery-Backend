import { ApiProperty } from '@nestjs/swagger';

// Response DTOs for the payments controller. The @nestjs/swagger CLI plugin
// infers @ApiProperty from TS field types at `nest build`; manual @ApiProperty
// is only used where the plugin needs a hint (enums, descriptions).

export class PaymentMethodResponseDto {
  id: string;
  userId: string;
  // stripePaymentMethodId is a Stripe-internal identifier — omitted from the
  // documented contract to avoid exposing implementation details to clients.
  network: string;
  last4: string;
  holderName: string;
  /** Formatted as MM/YYYY. */
  expiry: string;
  isDefault: boolean;
  createdAt: Date;
}

export class SetupIntentResponseDto {
  /** Stripe SetupIntent client secret — pass to the mobile PaymentSheet. */
  setupIntentClientSecret: string;
  /** Stripe ephemeral key for the customer session (null in mock mode). */
  ephemeralKeySecret: string | null;
  customerId: string;
  /** Stripe publishable key for the mobile SDK (null in mock mode). */
  publishableKey: string | null;
  /** True when the server is running in mock (non-Stripe) mode. */
  mock: boolean;
}

export class RemovePaymentMethodResponseDto {
  @ApiProperty({ description: 'Always true when the method was deleted.' })
  success: boolean;
}
