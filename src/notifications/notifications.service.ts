import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto, UpdateNotificationPreferencesDto } from './dto';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type NotificationCategory = 'delivery' | 'promotion' | 'system';

// Returned when a user hasn't customized their preferences (lazy — not persisted).
const DEFAULT_PREFERENCES = {
  pushEnabled: true,
  deliveryUpdates: true,
  promotions: true,
  quietHoursStart: null as number | null,
  quietHoursEnd: null as number | null,
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findAll(userId: string) {
    // The notification feed — lag-tolerant → read replica (falls back to primary).
    return this.prisma.readWithFallback((c) =>
      c.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  async markAsRead(userId: string, notificationId: string) {
    // `notifications` is composite-PK (id, createdAt) for partitioning, so there is
    // no single-column `id` unique — findUnique/update({ where: { id } }) is gone.
    // Mark read with an ownership-scoped updateMany: ownership lives IN the write
    // (no read-then-write TOCTOU), and a cross-user / missing id yields count 0 →
    // 404 (no 403 existence oracle). id is a uuid so this matches at most one row.
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });

    if (count === 0) {
      throw new NotFoundException(
        `Notification with id "${notificationId}" not found`,
      );
    }

    // Return the full updated row (keeps the NotificationResponseDto contract);
    // findFirst — not findUnique — since id alone is no longer a unique where. Null-
    // check it: if the row vanished between the update and this read (a future
    // delete/dismiss path or aggressive retention), surface a 404 rather than a
    // 200 with data:null against a non-null DTO.
    const updated = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!updated) {
      throw new NotFoundException(
        `Notification with id "${notificationId}" not found`,
      );
    }
    return updated;
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return { updated: result.count };
  }

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    return this.prisma.device.upsert({
      where: {
        userId_pushToken: {
          userId,
          pushToken: dto.pushToken,
        },
      },
      update: {
        platform: dto.platform,
      },
      create: {
        userId,
        pushToken: dto.pushToken,
        platform: dto.platform,
      },
    });
  }

  async create(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    category: NotificationCategory = 'delivery',
  ) {
    // The in-app record is ALWAYS created (the feed stays complete); preferences
    // only gate the push buzz.
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: (data as any) ?? undefined,
      },
    });

    // Fan out as a real push, subject to the user's preferences + quiet hours
    // (fire-and-forget; a failed/absent/suppressed push never breaks creation).
    void this.maybeSendPush(userId, title, body, data, category);

    this.logger.log(`Notification "${title}" created for user ${userId}`);

    return notification;
  }

  /** A user's notification preferences (defaults when not customized). */
  async getPreferences(userId: string) {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    return prefs ?? { userId, ...DEFAULT_PREFERENCES };
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    // A quiet-hours window needs BOTH bounds — a half-set window (e.g. start
    // without end) silently does nothing (see `inQuietHours`), which reads as a
    // broken setting. Validate the *effective* state after the partial update,
    // so changing one bound while the other is already persisted still works.
    const current = await this.getPreferences(userId);
    const start =
      dto.quietHoursStart !== undefined
        ? dto.quietHoursStart
        : current.quietHoursStart;
    const end =
      dto.quietHoursEnd !== undefined
        ? dto.quietHoursEnd
        : current.quietHoursEnd;
    if ((start == null) !== (end == null)) {
      throw new BadRequestException(
        'quietHoursStart and quietHoursEnd must be set together (or both cleared)',
      );
    }

    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto },
    });
  }

  private async maybeSendPush(
    userId: string,
    title: string,
    body: string,
    data: Record<string, unknown> | undefined,
    category: NotificationCategory,
  ): Promise<void> {
    try {
      if (await this.shouldSendPush(userId, category)) {
        await this.sendPushToUser(userId, title, body, data);
      }
    } catch (error) {
      this.logger.warn(
        `Push gate failed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  private async shouldSendPush(
    userId: string,
    category: NotificationCategory,
  ): Promise<boolean> {
    const p = await this.getPreferences(userId);
    if (!p.pushEnabled) return false;
    if (category === 'delivery' && !p.deliveryUpdates) return false;
    if (category === 'promotion' && !p.promotions) return false;
    if (this.inQuietHours(p.quietHoursStart, p.quietHoursEnd)) return false;
    return true;
  }

  /** Is `hour` inside the [start, end) quiet-hours window (handles wrap-around)? */
  private inQuietHours(
    start: number | null,
    end: number | null,
    hour: number = this.currentServiceHour(),
  ): boolean {
    if (start == null || end == null || start === end) return false;
    return start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end; // e.g. 22 → 7
  }

  /**
   * Current hour-of-day in the configured service timezone (not the container's
   * local/UTC clock). Quiet hours are wall-clock, so evaluating them in UTC
   * would shift every Indonesian user's window by ~7 hours.
   */
  private currentServiceHour(): number {
    const tz =
      this.config.get<string>('notifications.timezone') ?? 'Asia/Jakarta';
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz,
      }).formatToParts(new Date());
      const hour = Number(parts.find((p) => p.type === 'hour')?.value);
      // hour12:false renders midnight as "24" in some ICU builds — normalize.
      return Number.isFinite(hour) ? hour % 24 : new Date().getHours();
    } catch {
      // Misconfigured TZ string → degrade to server-local rather than crash.
      return new Date().getHours();
    }
  }

  /**
   * Sends an Expo push notification to every device the user has registered.
   * Best-effort: skips silently when there are no Expo tokens, and never throws.
   */
  private async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const devices =
        (await this.prisma.device.findMany({
          where: { userId },
        })) ?? [];

      const messages = devices
        .map((d) => d.pushToken)
        .filter(
          (token) =>
            typeof token === 'string' &&
            (token.startsWith('ExponentPushToken') ||
              token.startsWith('ExpoPushToken')),
        )
        .map((to) => ({ to, title, body, data, sound: 'default' as const }));

      if (messages.length === 0) return;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      const accessToken = this.config.get<string>('expo.accessToken');
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        this.logger.warn(`Expo push request failed with status ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Push send failed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.readWithFallback((c) =>
      c.notification.count({
        where: { userId, read: false },
      }),
    );

    return { count };
  }
}
