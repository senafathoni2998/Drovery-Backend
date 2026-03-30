import { IsIn, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../common/dto/pagination.dto';

export class DeliveryQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['current', 'completed', 'canceled'])
  status?: 'current' | 'completed' | 'canceled';

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['recent', 'title', 'status'])
  sort?: 'recent' | 'title' | 'status' = 'recent';
}
