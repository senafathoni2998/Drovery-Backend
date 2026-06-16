import { ApiProperty } from '@nestjs/swagger';

// Response DTOs for the Workflows feature.
// The @nestjs/swagger CLI plugin infers @ApiProperty from TypeScript field types
// at build time; we only use explicit @ApiProperty for enums, arrays of objects,
// and fields where the description adds real value.

// ---- Workflow definition DTOs (returned by getAll / getWorkflow) ----

export class WorkflowIndicatorDto {
  label: string;
  color: string;
  description: string;
}

export class WorkflowChecklistItemDto {
  id: string;
  label: string;
}

export class WorkflowStepResponseDto {
  id: string;
  @ApiProperty({
    enum: [
      'checklist',
      'qr_display',
      'qr_scan',
      'instruction',
      'drone_button',
      'status_check',
    ],
    description: 'UI control type that the mobile client should render.',
  })
  type: string;

  title: string;
  instruction: string;
  nextLabel: string;

  @ApiProperty({ type: [WorkflowChecklistItemDto], required: false })
  items?: WorkflowChecklistItemDto[];

  hint?: string;
  icon?: string;
  iconColor?: string;
  indicator?: WorkflowIndicatorDto;
}

export class WorkflowResponseDto {
  id: string;
  title: string;
  subtitle: string;

  @ApiProperty({ type: [WorkflowStepResponseDto] })
  steps: WorkflowStepResponseDto[];
}

// ---- QR payload DTOs ----

export class QrGenerateResponseDto {
  @ApiProperty({
    description:
      'Signed, time-limited JSON payload (HMAC-SHA256) to be rendered as a QR code. Valid for 5 minutes.',
  })
  payload: string;
}

export class QrValidateResponseDto {
  valid: boolean;

  @ApiProperty({
    description:
      'The delivery ID extracted from a valid payload (absent when valid=false).',
    required: false,
  })
  deliveryId?: string;

  @ApiProperty({
    enum: ['malformed', 'bad_signature', 'expired'],
    description: 'Failure reason (absent when valid=true).',
    required: false,
  })
  reason?: string;
}
