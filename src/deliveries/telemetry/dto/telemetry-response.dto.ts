import { ApiProperty } from '@nestjs/swagger';
import { DeliveryStatus } from '@prisma/client';

/**
 * Response body returned by POST /ingest/telemetry.
 * Mirrors the IngestResult interface from TelemetryService.ingest().
 */
export class TelemetryIngestResponseDto {
  /** Whether the frame was accepted and produced a state change (status or position). */
  applied: boolean;

  /**
   * The delivery status that was applied as a result of this frame's phase,
   * if the phase advanced the delivery state machine. Absent when the frame
   * carried no phase, the phase was a no-op (stale/out-of-order), or the
   * frame was a position-only update.
   */
  @ApiProperty({ enum: DeliveryStatus, required: false })
  status?: DeliveryStatus;
}
