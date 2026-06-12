import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../../config/redis';
import { supportChatChannel } from './support-chat.publisher';

/** Frame as published to Redis: an already-shaped {event, data} envelope. */
export interface SupportChatFrame {
  event: string;
  data: unknown;
}

type ChatHandler = (ticketId: string, frame: SupportChatFrame) => void;

const PREFIX = 'support:ticket:';
const SUFFIX = ':messages';

/**
 * API-side half of the chat bridge — mirrors TrackingSubscriber. Holds a
 * DEDICATED ioredis subscriber connection and dynamically (un)subscribes to
 * per-ticket channels as WS clients come and go. On each message it invokes the
 * handler the gateway registered (via onUpdate), so there's no DI cycle (the
 * subscriber never imports the gateway).
 */
@Injectable()
export class SupportChatSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportChatSubscriber.name);
  private sub!: Redis;
  private handler?: ChatHandler;

  constructor(private readonly config: ConfigService) {}

  /** The gateway registers its local-fanout function here. */
  onUpdate(handler: ChatHandler) {
    this.handler = handler;
  }

  onModuleInit() {
    this.sub = new Redis({
      ...buildRedisOptions(this.config),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.sub.on('error', (e) =>
      this.logger.warn(`support chat subscriber redis error: ${e.message}`),
    );
    this.sub.on('message', (channel: string, message: string) =>
      this.dispatch(channel, message),
    );
    this.logger.log('SupportChatSubscriber ready');
  }

  /** Parse a Redis message and forward to the gateway's local fanout. */
  dispatch(channel: string, message: string) {
    try {
      const frame = JSON.parse(message) as SupportChatFrame;
      const ticketId = channel.slice(PREFIX.length, -SUFFIX.length);
      this.handler?.(ticketId, frame);
    } catch (e) {
      this.logger.warn(
        `support chat message parse failed: ${(e as Error).message}`,
      );
    }
  }

  subscribeToTicket(ticketId: string) {
    this.sub
      .subscribe(supportChatChannel(ticketId))
      .catch((e) =>
        this.logger.warn(`subscribe ${ticketId} failed: ${e.message}`),
      );
  }

  unsubscribeFromTicket(ticketId: string) {
    this.sub.unsubscribe(supportChatChannel(ticketId)).catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
