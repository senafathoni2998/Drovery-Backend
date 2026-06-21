import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../../config/redis';
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

  constructor(private readonly config: ConfigService) {}

  /** The gateway registers its local-fanout function here. */
  onUpdate(handler: UpdateHandler) {
    this.handler = handler;
  }

  onModuleInit() {
    this.sub = new Redis({
      ...buildRedisOptions(this.config, 'pubsub'),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    this.sub.on('error', (e) =>
      this.logger.warn(`tracking subscriber redis error: ${e.message}`),
    );
    this.sub.on('message', (channel: string, message: string) =>
      this.dispatch(channel, message),
    );
    this.logger.log('TrackingSubscriber ready');
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
    this.sub
      .subscribe(trackingChannel(deliveryId))
      .catch((e) =>
        this.logger.warn(`subscribe ${deliveryId} failed: ${e.message}`),
      );
  }

  unsubscribeFromDelivery(deliveryId: string) {
    this.sub.unsubscribe(trackingChannel(deliveryId)).catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
