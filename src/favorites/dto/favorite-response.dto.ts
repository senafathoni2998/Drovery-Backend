// Response DTOs for the favorites feature (Swagger/OpenAPI documentation).
// The @nestjs/swagger CLI plugin infers @ApiProperty from TS field types at
// `nest build`, so explicit @ApiProperty is only added where needed for
// descriptions or non-inferrable shapes.

export class FavoriteResponseDto {
  id: string;
  userId: string;
  /** User-defined display name for this saved template. */
  label: string;

  fromAddress: string;
  toAddress: string;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;

  receiver: string;
  packages: string;
  packageSize: string;
  packageWeight: number;
  packageTypes: string[];

  createdAt: Date;
  updatedAt: Date;
}
