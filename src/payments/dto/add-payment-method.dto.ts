import { IsNotEmpty, IsString } from 'class-validator';

export class AddPaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  network: string;

  @IsString()
  @IsNotEmpty()
  last4: string;

  @IsString()
  @IsNotEmpty()
  holderName: string;

  @IsString()
  @IsNotEmpty()
  expiry: string;
}
