import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { MetricsService } from '../../metrics/metrics.service';
import { TELEMETRY_FILTER } from '../../mqtt/mqtt.constants';
import { MqttService } from '../../mqtt/mqtt.service';
import { TelemetryMessage } from './telemetry.constants';
import { TelemetryService } from './telemetry.service';

/**
 * OPTIONAL real-IoT telemetry transport. Subscribes `drovery/telemetry/+` via the shared
 * MqttService and forwards every frame to the SAME safety core as HTTP (TelemetryService.
 * ingest), so it's a drop-in second producer. Inert when MQTT is disabled (MqttService is
 * a no-op in MOCK mode) — the HTTP /ingest/telemetry endpoint stays the active transport.
 *
 * handleMessage is the unit-testable seam: it parses + delegates to ingest() without ever
 * opening a broker connection (so the same ingest assertions cover the MQTT path, no broker).
 */
@Injectable()
export class MqttTelemetrySubscriber implements OnModuleInit {
  private readonly logger = new Logger(MqttTelemetrySubscriber.name);

  constructor(
    private readonly mqtt: MqttService,
    private readonly telemetry: TelemetryService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.mqtt.subscribe(
      TELEMETRY_FILTER,
      (raw) => void this.handleMessage(raw),
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
      this.metrics.mqttFramesTotal.inc({
        flow: 'telemetry',
        result: 'dropped',
      });
      this.logger.warn('Dropped malformed MQTT telemetry frame (invalid JSON)');
      return;
    }
    try {
      await this.telemetry.ingest(msg);
      this.metrics.mqttFramesTotal.inc({ flow: 'telemetry', result: 'ok' });
    } catch (error) {
      this.metrics.mqttFramesTotal.inc({
        flow: 'telemetry',
        result: 'rejected',
      });
      this.logger.warn(
        `MQTT telemetry frame rejected: ${(error as Error).message}`,
      );
    }
  }
}
