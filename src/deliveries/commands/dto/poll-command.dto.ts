import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Query for GET /ingest/commands — the polling drone identifies itself. */
export class PollCommandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  droneId!: string;
}
