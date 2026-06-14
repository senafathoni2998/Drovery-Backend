import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Body for POST /ingest/commands/:id/ack — the drone confirms (or refuses) a command. */
export class AckCommandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  droneId!: string;

  // The drone accepted and will execute the command (default). false = refused
  // (e.g. unsafe to comply) → the command is REJECTED and no transition fires.
  @IsOptional()
  @IsBoolean()
  accepted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
