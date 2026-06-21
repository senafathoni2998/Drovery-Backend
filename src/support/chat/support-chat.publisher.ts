import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../../config/redis';
import {
  PUBSUB_MODE_STANDARD,
  type PubSubMode,
  pubSubPublish,
  resolvePubSubMode,
} from '../../common/pubsub/pubsub-transport';

export type SupportChatSenderRole = 'USER' | 'AGENT' | 'SYSTEM';

/** The wire shape of a chat message — identical across WS frames and REST. */
export interface SupportChatMessagePayload {
  id: string;
  ticketId: string;
  senderRole: SupportChatSenderRole;
  senderUserId: string | null;
  content: string;
  createdAt: string; // ISO 8601
}

/** A Prisma SupportChatMessage row (the subset we put on the wire). */
type SupportChatRow = {
  id: string;
  ticketId: string;
  senderRole: string;
  senderUserId: string | null;
  content: string;
  createdAt: Date;
};

/** Map a persisted row to the wire payload (single source of truth for shape). */
export function toSupportChatPayload(
  m: SupportChatRow,
): SupportChatMessagePayload {
  return {
    id: m.id,
    ticketId: m.ticketId,
    senderRole: m.senderRole as SupportChatSenderRole,
    senderUserId: m.senderUserId,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Single source of truth for the per-ticket channel — imported by both the
 * publisher and the subscriber so the string never drifts. */
export const supportChatChannel = (ticketId: string) =>
  `support:ticket:${ticketId}:messages`;

/**
 * Publishes chat messages to Redis so a message accepted on ANY api replica
 * reaches every subscribed client on every replica. Deliberately NOT owned by
 * the gateway: it lives in SupportModule and runs everywhere, so a future
 * agent/admin surface (on any tier) can inject an AGENT message by calling this
 * same publisher — no gateway changes needed. Fail-open: a publish error never
 * breaks the request (the message is already persisted; the next history fetch
 * is authoritative).
 */
@Injectable()
export class SupportChatPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportChatPublisher.name);
  private client!: Redis;
  // Defaults to 'standard' so unit tests that inject a mock client (skipping
  // onModuleInit) stay byte-identical; onModuleInit reads the real mode from config.
  private mode: PubSubMode = PUBSUB_MODE_STANDARD;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.mode = resolvePubSubMode(this.config);
    this.client = new Redis({
      ...buildRedisOptions(this.config, 'pubsub'),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) =>
      this.logger.warn(`support chat publisher redis error: ${e.message}`),
    );
    this.logger.log(`SupportChatPublisher ready (pubsub mode: ${this.mode})`);
  }

  async publishMessage(payload: SupportChatMessagePayload): Promise<void> {
    try {
      await pubSubPublish(
        this.client,
        supportChatChannel(payload.ticketId),
        JSON.stringify({ event: 'message:new', data: payload }),
        this.mode,
      );
    } catch (e) {
      this.logger.warn(`support chat publish failed: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }
}
