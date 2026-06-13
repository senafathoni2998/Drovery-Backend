import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { PaginationDto } from '../../common/dto/pagination.dto';

export class RecurringQueryDto extends PaginationDto {
  // ?active=true|false filters by state; absent = no filter.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  active?: boolean;
}
