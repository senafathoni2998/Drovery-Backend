import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { COMMAND_ACK_FILTER } from '../../mqtt/mqtt.constants';
import { MqttService } from '../../mqtt/mqtt.service';
import { DroneCommandService } from './drone-command.service';

interface AckFrame {
  commandId?: string;
  droneId?: string;
  accepted?: boolean;
  note?: string;
}

/**
 * Drone → backend command ACK over MQTT (`drovery/commands/ack`), the broker-transport twin
 * of POST /ingest/commands/:id/ack. handleAck is the unit-testable seam: it parses + drives
 * the SAME single-winner ack core (DroneCommandService.ack), so a duplicate/raced ack 409s
 * internally and never double-fires the transition. Inert when MQTT is disabled.
 */
@Injectable()
export class MqttCommandAckSubscriber implements OnModuleInit {
  private readonly logger = new Logger(MqttCommandAckSubscriber.name);

  constructor(
    private readonly mqtt: MqttService,
    private readonly commands: DroneCommandService,
  ) {}

  onModuleInit(): void {
    this.mqtt.subscribe(COMMAND_ACK_FILTER, (raw) => void this.handleAck(raw));
  }

  async handleAck(raw: string): Promise<void> {
    let frame: AckFrame;
    try {
      frame = JSON.parse(raw) as AckFrame;
    } catch {
      this.logger.warn('Dropped malformed MQTT ack frame (invalid JSON)');
      return;
    }
    const { commandId, droneId } = frame;
    if (!commandId || !droneId) {
      this.logger.warn('Dropped MQTT ack frame missing commandId/droneId');
      return;
    }
    try {
      await this.commands.ack(
        commandId,
        droneId,
        frame.accepted ?? true,
        frame.note?.slice(0, 200),
      );
    } catch (error) {
      // ack() is the single-winner CAS — a duplicate/raced/unauthorized ack throws
      // (409/403/404). Swallow so the transport never retries into the broker loop.
      this.logger.warn(
        `MQTT ack for ${commandId} rejected: ${(error as Error).message}`,
      );
    }
  }
}
