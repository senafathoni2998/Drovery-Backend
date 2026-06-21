// Response DTOs for the notifications feature — documentation contracts for
// Swagger/OpenAPI. The @nestjs/swagger CLI plugin infers each property from its
// TS type at `nest build`; @ApiProperty is used only for descriptions and
// special cases (e.g. Json fields rendered as `object`).

import { ApiProperty } from '@nestjs/swagger';

export class NotificationResponseDto {
  id: string;
  userId: string;
  title: string;
  body: string;
  /** Arbitrary key-value payload attached to the notification (delivery id, etc.). */
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: Date;
}

export class UnreadCountDto {
  /** Number of unread notifications for the authenticated user. */
  count: number;
}

export class NotificationPreferenceDto {
  // GET /preferences returns a lazy default ({ userId, ...DEFAULT_PREFERENCES })
  // when the user has no saved row, so id/createdAt/updatedAt are absent there;
  // PATCH always upserts a real row that includes them. Hence optional.
  id?: string;
  userId: string;
  pushEnabled: boolean;
  deliveryUpdates: boolean;
  promotions: boolean;
  /**
   * Start of the quiet-hours window (hour-of-day, 0–23, evaluated in the
   * service timezone — default Asia/Jakarta). Null when quiet hours are off.
   */
  quietHoursStart: number | null;
  /**
   * End of the quiet-hours window (hour-of-day, 0–23, exclusive). Must be set
   * together with quietHoursStart; null when quiet hours are off.
   */
  quietHoursEnd: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class MarkAllReadResultDto {
  /** Number of notifications that were flipped from unread to read. */
  updated: number;
}

export class DeviceResponseDto {
  id: string;
  userId: string;
  pushToken: string;
  /** "ios" or "android". */
  platform: string;
  createdAt: Date;
}
