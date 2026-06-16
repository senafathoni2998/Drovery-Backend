// Response DTOs for the health controller. The CLI plugin infers all scalar
// fields from their TS types; @ApiProperty is only used for descriptions.

export class HealthChecksDto {
  /** Whether the Prisma/Postgres connection is reachable. */
  database: boolean;
  /** Whether the Redis/Cache connection is reachable. */
  redis: boolean;
}

export class LiveResponseDto {
  /** Always "ok" when the process is serving. */
  status: string;
  /** Process uptime in whole seconds. */
  uptime: number;
  /** ISO-8601 timestamp at the moment of the probe. */
  timestamp: string;
}

export class ReadyResponseDto {
  /** "ok" when all dependencies are reachable; "error" otherwise. */
  status: string;
  checks: HealthChecksDto;
}
