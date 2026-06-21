import { Global, Module } from '@nestjs/common';

import { MqttService } from './mqtt.service';

/**
 * The shared MQTT client, exposed app-wide. @Global + a dependency-free leaf (MqttService
 * injects only ConfigService), so any module can inject MqttService without an import edge
 * back here — there's no way to form a DI cycle (every MQTT edge points INTO this module).
 * Inert unless MQTT_URL is set.
 */
@Global()
@Module({
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
