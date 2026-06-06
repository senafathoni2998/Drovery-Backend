import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findAll(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException(
        `Notification with id "${notificationId}" not found`,
      );
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
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
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: (data as any) ?? undefined,
      },
    });

    // Fan out to the user's registered devices as a real push (fire-and-forget;
    // a failed/absent push must never break notification creation).
    void this.sendPushToUser(userId, title, body, data);

    this.logger.log(
      `Notification "${title}" created for user ${userId}`,
    );

    return notification;
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
      const devices = (await this.prisma.device.findMany({
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
        this.logger.warn(
          `Expo push request failed with status ${res.status}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Push send failed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });

    return { count };
  }
}
