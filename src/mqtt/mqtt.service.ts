import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type MqttClient, connect } from 'mqtt';

import { sharedFilter } from './mqtt.constants';

type MessageHandler = (payload: string) => void;

/**
 * Owns the ONE shared MQTT client for the optional push transport. Lifecycle mirrors
 * TrackingPublisher/TrackingSubscriber (Redis): when `mqtt.url` is UNSET it is fully INERT
 * (no client, no connection — publish/subscribe are no-ops), so the default config + the
 * whole test suite are untouched and the HTTP /ingest path stays the active transport.
 *
 * FAIL-OPEN: the connect is non-blocking (NestFactory boot never waits on a broker), and
 * every transport event (error/offline/close) ONLY warns — a down broker degrades to
 * HTTP-only, never crashes the process or blocks a request. Subscriptions are re-armed on
 * every (re)connect. Outbound publishes are best-effort and bounded (a long outage can't OOM).
 *
 * Subscribers register a BARE filter (e.g. drovery/telemetry/+); when `mqtt.shared` is on
 * the actual broker subscription is $share-wrapped so exactly one api replica gets each
 * frame, but dispatch matches the incoming topic against the bare filter.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client?: MqttClient;
  /** bare filter → handler (the broker subscription may be $share-wrapped). */
  private readonly handlers = new Map<string, MessageHandler>();
  private offlineQueued = 0;

  constructor(private readonly config: ConfigService) {}

  isMock(): boolean {
    return !this.config.get<string>('mqtt.url');
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  onModuleInit(): void {
    const url = this.config.get<string>('mqtt.url');
    if (!url) {
      this.logger.log(
        'MQTT disabled (MOCK mode) — HTTP /ingest is the active drone transport.',
      );
      return;
    }
    const shared = this.config.get<boolean>('mqtt.shared');
    this.client = connect(url, {
      username: this.config.get<string>('mqtt.username'),
      password: this.config.get<string>('mqtt.password'),
      reconnectPeriod: this.config.get<number>('mqtt.reconnectMs') ?? 5000,
      connectTimeout: 10_000,
      queueQoSZero: false,
    });
    // Fail-open: never throw out of a transport event.
    this.client.on('error', (e) =>
      this.logger.warn(`mqtt error: ${e.message}`),
    );
    this.client.on('offline', () =>
      this.logger.warn('mqtt offline — falling back to HTTP ingest'),
    );
    this.client.on('connect', () => {
      this.logger.log('mqtt connected');
      this.offlineQueued = 0;
      // Re-arm every registered subscription so a reconnect restores them.
      for (const filter of this.handlers.keys()) this.armSubscription(filter);
    });
    this.client.on('message', (topic, payload) =>
      this.dispatch(topic, payload.toString()),
    );
    this.logger.log(`MqttService connecting to ${url} (shared=${shared})`);
  }

  /** Register a handler for a bare topic filter. (Re)subscribes on connect. No-op in MOCK. */
  subscribe(filter: string, handler: MessageHandler): void {
    if (!this.client) return;
    this.handlers.set(filter, handler);
    if (this.client.connected) this.armSubscription(filter);
  }

  private armSubscription(filter: string): void {
    const shared = this.config.get<boolean>('mqtt.shared');
    const group =
      this.config.get<string>('mqtt.shareGroup') ?? 'drovery-ingest';
    const sub = shared ? sharedFilter(group, filter) : filter;
    this.client?.subscribe(sub, { qos: 1 }, (err) => {
      if (err) this.logger.warn(`mqtt subscribe ${sub} failed: ${err.message}`);
    });
  }

  /** Best-effort publish (fire-and-forget, never throws). Bounded while offline. No-op in MOCK. */
  publish(topic: string, payload: unknown): void {
    if (!this.client) return;
    const max = this.config.get<number>('mqtt.offlineQueueMax') ?? 1000;
    if (!this.client.connected && this.offlineQueued >= max) {
      this.logger.warn(
        `mqtt offline queue full (${max}) — dropping publish to ${topic}`,
      );
      return;
    }
    if (!this.client.connected) this.offlineQueued++;
    try {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (this.offlineQueued > 0) this.offlineQueued--;
        if (err)
          this.logger.warn(`mqtt publish ${topic} failed: ${err.message}`);
      });
    } catch (e) {
      this.logger.warn(`mqtt publish ${topic} threw: ${(e as Error).message}`);
    }
  }

  /** Route an incoming message to the handler whose BARE filter matches the topic. */
  dispatch(topic: string, payload: string): void {
    for (const [filter, handler] of this.handlers) {
      if (MqttService.topicMatches(filter, topic)) {
        try {
          handler(payload);
        } catch (e) {
          this.logger.warn(
            `mqtt handler for ${filter} threw: ${(e as Error).message}`,
          );
        }
        return;
      }
    }
  }

  /** MQTT topic-filter match (+ single level, # multi level). */
  static topicMatches(filter: string, topic: string): boolean {
    const f = filter.split('/');
    const t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
      if (f[i] === '#') return true;
      if (f[i] === '+') {
        if (t[i] === undefined) return false;
        continue;
      }
      if (f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }

  onModuleDestroy(): void {
    // force=true → close immediately without waiting on in-flight (a down broker can't hang us).
    this.client?.end(true);
  }
}
