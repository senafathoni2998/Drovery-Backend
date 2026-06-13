import { IsIn, IsOptional } from 'class-validator';

import { PaginationDto } from '../../common/dto/pagination.dto';

export class RecurringQueryDto extends PaginationDto {
  // ?active=true|false filters by state; absent = no filter. Validated as a
  // string (not boolean) so the global ValidationPipe's enableImplicitConversion
  // can't re-coerce "false" to true via Boolean("false"); read activeFilter.
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;

  get activeFilter(): boolean | undefined {
    return this.active === undefined ? undefined : this.active === 'true';
  }
}
