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
import { TrackingUpdatePayload, trackingChannel } from './tracking.publisher';

type UpdateHandler = (deliveryId: string, data: TrackingUpdatePayload) => void;

const PREFIX = 'delivery:';
const SUFFIX = ':update';

/**
 * API-side half of the bridge. Holds a DEDICATED ioredis subscriber connection
 * (a client in subscribe mode can't run normal commands) and dynamically
 * (un)subscribes to per-delivery channels as WS clients come and go. On each
 * message it invokes the handler the gateway registered, so there's no DI cycle.
 */
@Injectable()
export class TrackingSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingSubscriber.name);
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

  private handler?: UpdateHandler;
  // Defaults to 'standard' so unit tests that inject a mock sub (skipping
  // onModuleInit) route to subscribe/unsubscribe; onModuleInit reads the real mode.
  private mode: PubSubMode = PUBSUB_MODE_STANDARD;

  constructor(private readonly config: ConfigService) {}

  /** The gateway registers its local-fanout function here. */
  onUpdate(handler: UpdateHandler) {
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
      this.logger.warn(`tracking subscriber redis error: ${e.message}`),
    );
    // Re-arm every desired channel whenever the connection comes back.
    this.sub.on('ready', () => this.rearmAll());
    this.wireMessageListener(this.sub);
    this.logger.log(`TrackingSubscriber ready (pubsub mode: ${this.mode})`);
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
      const payload = JSON.parse(message) as TrackingUpdatePayload;
      const deliveryId = channel.slice(PREFIX.length, -SUFFIX.length);
      this.handler?.(deliveryId, payload);
    } catch (e) {
      this.logger.warn(`pubsub message parse failed: ${(e as Error).message}`);
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
      `tracking redis ready — re-arming ${this.desired.size} subscription(s)`,
    );
    for (const channel of this.desired) {
      pubSubSubscribe(this.sub, channel, this.mode).catch((e: Error) =>
        this.logger.warn(`re-arm ${channel} failed: ${e.message}`),
      );
    }
  }

  subscribeToDelivery(deliveryId: string) {
    const channel = trackingChannel(deliveryId);
    // Record the intent FIRST: if the SUBSCRIBE below fails because Redis is
    // unreachable, the 'ready' handler re-arms it instead of losing it forever.
    this.desired.add(channel);
    pubSubSubscribe(this.sub, channel, this.mode).catch((e: Error) =>
      this.logger.warn(
        `subscribe ${deliveryId} failed (will re-arm on reconnect): ${e.message}`,
      ),
    );
  }

  unsubscribeFromDelivery(deliveryId: string) {
    const channel = trackingChannel(deliveryId);
    this.desired.delete(channel);
    pubSubUnsubscribe(this.sub, channel, this.mode).catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
