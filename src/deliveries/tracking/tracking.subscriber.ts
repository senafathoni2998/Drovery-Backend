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

  subscribeToDelivery(deliveryId: string) {
    pubSubSubscribe(this.sub, trackingChannel(deliveryId), this.mode).catch(
      (e: Error) =>
        this.logger.warn(`subscribe ${deliveryId} failed: ${e.message}`),
    );
  }

  unsubscribeFromDelivery(deliveryId: string) {
    pubSubUnsubscribe(this.sub, trackingChannel(deliveryId), this.mode).catch(
      () => undefined,
    );
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
