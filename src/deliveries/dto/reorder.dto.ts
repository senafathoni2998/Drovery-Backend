import { IsOptional, IsString } from 'class-validator';

// Optional pickup override for a reorder; both omitted → immediate (now).
export class ReorderDto {
  @IsOptional()
  @IsString()
  pickupDate?: string;

  @IsOptional()
  @IsString()
  pickupTime?: string;
}
