import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelemetryMessage } from './telemetry.constants';
import { TelemetryService } from './telemetry.service';

/**
 * OPTIONAL real-IoT transport, deferred (no broker / no `mqtt` dep is installed).
 * Mirrors the real-or-mock posture of WeatherService: when MQTT_URL is unset it
 * logs a disabled/MOCK notice and is a no-op; the HTTP endpoint remains the
 * testable primary transport. When a broker IS configured for production, wire
 * an mqtt client in onModuleInit to subscribe to `drovery/telemetry/+` and call
 * the SAME handleMessage() below — the safety core (TelemetryService.ingest) is
 * unchanged, so the transport is a drop-in.
 *
 * handleMessage is the unit-testable seam: it parses + delegates to ingest()
 * without ever opening a broker connection (so the same ingest assertions cover
 * the MQTT path with no broker/hardware).
 */
@Injectable()
export class MqttTelemetrySubscriber implements OnModuleInit {
  private readonly logger = new Logger(MqttTelemetrySubscriber.name);

  constructor(
    private readonly config: ConfigService,
    private readonly telemetry: TelemetryService,
  ) {}

  onModuleInit(): void {
    const url = this.config.get<string>('MQTT_URL');
    if (!url) {
      this.logger.log(
        'MQTT_URL not set — telemetry MQTT subscriber disabled (MOCK mode). HTTP ingest endpoint is the active transport.',
      );
      return;
    }
    // Deferred: a production broker integration needs the `mqtt` client (an
    // optional runtime dep) + TLS/mTLS device certs. We do NOT pull the dep or
    // open a connection here — this remains a documented shell so a reviewer
    // can't mistake it for a tested live broker integration.
    this.logger.warn(
      `MQTT_URL is set (${url}) but the broker client is not installed — live MQTT ingestion is deferred. Install + wire 'mqtt' to enable; HTTP ingest remains active.`,
    );
  }

  /**
   * Transport adapter: parse a raw broker payload and forward to the shared
   * ingest core. Bad JSON is logged and dropped so a malformed frame never
   * throws into the broker loop (mirrors TrackingSubscriber.dispatch).
   */
  async handleMessage(raw: string | Buffer): Promise<void> {
    let msg: TelemetryMessage;
    try {
      msg = JSON.parse(raw.toString()) as TelemetryMessage;
    } catch {
      this.logger.warn('Dropped malformed MQTT telemetry frame (invalid JSON)');
      return;
    }
    try {
      await this.telemetry.ingest(msg);
    } catch (error) {
      this.logger.warn(
        `MQTT telemetry frame rejected: ${(error as Error).message}`,
      );
    }
  }
}
