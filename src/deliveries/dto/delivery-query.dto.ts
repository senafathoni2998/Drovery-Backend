import { IsIn, IsOptional, IsString } from 'class-validator';

import { PaginationDto } from '../../common/dto/pagination.dto';

export class DeliveryQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['current', 'scheduled', 'completed', 'canceled'])
  status?: 'current' | 'scheduled' | 'completed' | 'canceled';

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['recent', 'title', 'status'])
  sort?: 'recent' | 'title' | 'status' = 'recent';
}
