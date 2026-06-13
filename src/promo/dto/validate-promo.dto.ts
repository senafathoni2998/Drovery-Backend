import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class ValidatePromoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;

  // The client's current estimate total — lets the preview apply the min-order
  // gate + compute the discounted total without re-pricing.
  @IsNumber()
  @IsPositive()
  orderTotal: number;
}
