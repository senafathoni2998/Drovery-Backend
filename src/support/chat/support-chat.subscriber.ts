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
  pubSubMessageEvent,
  pubSubSubscribe,
  pubSubUnsubscribe,
  resolvePubSubMode,
} from '../../common/pubsub/pubsub-transport';
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
  /**
   * Channels this replica WANTS to be subscribed to.
   *
   * The client is built with enableOfflineQueue:false, so a SUBSCRIBE issued while
   * Redis is unreachable rejects immediately — and the old code logged that and moved
   * on. The gateway had already put the socket in its local map and answered
   * `subscribed`, so the client was told it was live while no channel had been
   * registered, and nothing ever retried: the map entry being non-empty meant a later
   * subscriber reused it instead of re-subscribing. One blink of Redis silently
   * deafened those clients for the life of their socket.
   *
   * Keeping the desired set and re-arming on 'ready' makes a failed subscribe
   * temporary instead of permanent — the same thing MqttService does on 'connect'.
   */
  private readonly desired = new Set<string>();

  private handler?: ChatHandler;
  // Defaults to 'standard' so unit tests that inject a mock sub (skipping
  // onModuleInit) route to subscribe/unsubscribe; onModuleInit reads the real mode.
  private mode: PubSubMode = PUBSUB_MODE_STANDARD;

  constructor(private readonly config: ConfigService) {}

  /** The gateway registers its local-fanout function here. */
  onUpdate(handler: ChatHandler) {
    this.handler = handler;
  }

  onModuleInit() {
    this.mode = resolvePubSubMode(this.config);
    this.sub = new Redis({
      ...buildRedisOptions(this.config, 'pubsub'),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.sub.on('error', (e) =>
      this.logger.warn(`support chat subscriber redis error: ${e.message}`),
    );
    // Re-arm every desired channel whenever the connection comes back.
    this.sub.on('ready', () => this.rearmAll());
    this.wireMessageListener(this.sub);
    this.logger.log(`SupportChatSubscriber ready (pubsub mode: ${this.mode})`);
  }

  /** Registers dispatch on the ONE event matching the active mode: 'smessage'
   * (sharded) or 'message' (classic) — they're distinct events, so wiring the
   * wrong one silently receives nothing. Extracted so the mode→event wiring is
   * unit-testable without a live Redis. */
  private wireMessageListener(client: Pick<Redis, 'on'>) {
    client.on(
      pubSubMessageEvent(this.mode),
      (channel: string, message: string) => this.dispatch(channel, message),
    );
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

  /**
   * Re-subscribe everything this replica wants. Called on ioredis 'ready', so a
   * subscribe that failed while Redis was unreachable is recovered on reconnect
   * instead of leaving the client silently deaf. Extracted from the event handler so
   * it is testable without a live Redis.
   */
  rearmAll() {
    if (this.desired.size === 0) return;
    this.logger.log(
      `support chat redis ready — re-arming ${this.desired.size} subscription(s)`,
    );
    for (const channel of this.desired) {
      pubSubSubscribe(this.sub, channel, this.mode).catch((e: Error) =>
        this.logger.warn(`re-arm ${channel} failed: ${e.message}`),
      );
    }
  }

  subscribeToTicket(ticketId: string) {
    const channel = supportChatChannel(ticketId);
    // Intent first — see the `desired` docblock. A failed subscribe is re-armed on
    // reconnect rather than leaving the agent's chat permanently silent.
    this.desired.add(channel);
    pubSubSubscribe(this.sub, channel, this.mode).catch((e: Error) =>
      this.logger.warn(
        `subscribe ${ticketId} failed (will re-arm on reconnect): ${e.message}`,
      ),
    );
  }

  unsubscribeFromTicket(ticketId: string) {
    const channel = supportChatChannel(ticketId);
    this.desired.delete(channel);
    pubSubUnsubscribe(this.sub, channel, this.mode).catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
