import { ApiProperty } from '@nestjs/swagger';

// Response DTOs are documentation contracts for Swagger/OpenAPI. The
// @nestjs/swagger CLI plugin infers each field's schema from its TS type at
// build time; @ApiProperty is only needed for enums, arrays of objects, and
// descriptions that add real value.

export class SavedAddressResponseDto {
  id: string;
  userId: string;
  /** Human-readable label (e.g. "Home", "Office"). */
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class RecentAddressDto {
  address: string;
  lat: number | null;
  lng: number | null;
  /** Which side of the delivery this address was used on. */
  @ApiProperty({ enum: ['from', 'to'] })
  type: 'from' | 'to';
  /** Timestamp of the delivery that last used this address. */
  usedAt: Date;
}

export class RemoveSavedAddressResponseDto {
  /** Always true when the address was successfully deleted. */
  success: boolean;
}
