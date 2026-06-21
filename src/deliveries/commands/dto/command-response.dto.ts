import { ApiProperty } from '@nestjs/swagger';
import {
  DeliveryFailureReason,
  DroneCommandStatus,
  DroneCommandType,
} from '@prisma/client';

/**
 * The subset of a DroneCommand row that is handed to a polling drone
 * (operator-audit fields — issuedByUserId, appliedTransition, fetchedAt,
 * ackedAt, resultNote — are intentionally omitted; they are internal audit
 * columns that a drone client should never depend on).
 */
export class DroneCommandViewDto {
  id: string;
  deliveryId: string;
  droneId: string;
  @ApiProperty({ enum: DroneCommandType })
  type: DroneCommandType;
  @ApiProperty({ enum: DeliveryFailureReason })
  reason: DeliveryFailureReason;
  @ApiProperty({ enum: DroneCommandStatus })
  status: DroneCommandStatus;
  expiresAt: Date;
  createdAt: Date;
}

/** Response envelope returned by GET /ingest/commands (drone poll). */
export class PollCommandResponseDto {
  /** The next pending command for the drone, or null when the queue is empty. */
  @ApiProperty({ type: DroneCommandViewDto, nullable: true })
  command: DroneCommandViewDto | null;
}

/** Response returned by POST /ingest/commands/:id/ack (drone acknowledgement). */
export class AckCommandResponseDto {
  id: string;
  @ApiProperty({ enum: DroneCommandStatus })
  status: DroneCommandStatus;
  /** true if this ack successfully drove the delivery state-machine transition. */
  appliedTransition: boolean;
}
