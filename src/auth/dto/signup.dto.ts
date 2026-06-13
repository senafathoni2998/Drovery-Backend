import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  // Optional inviter's referral code. Links the referral (reward is granted on
  // this user's first delivery). Unknown/self codes are ignored — never blocks signup.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
