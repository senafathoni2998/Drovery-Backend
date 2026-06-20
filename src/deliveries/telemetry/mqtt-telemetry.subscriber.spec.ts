import { MqttTelemetrySubscriber } from './mqtt-telemetry.subscriber';
import { MqttService } from '../../mqtt/mqtt.service';
import { TelemetryService } from './telemetry.service';

describe('MqttTelemetrySubscriber', () => {
  let telemetry: { ingest: jest.Mock };
  let mqtt: { subscribe: jest.Mock };
  let sub: MqttTelemetrySubscriber;

  beforeEach(() => {
    telemetry = { ingest: jest.fn().mockResolvedValue(undefined) };
    mqtt = { subscribe: jest.fn() };
    sub = new MqttTelemetrySubscriber(
      mqtt as unknown as MqttService,
      telemetry as unknown as TelemetryService,
    );
  });

  it('registers the telemetry filter on init', () => {
    sub.onModuleInit();
    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'drovery/telemetry/+',
      expect.any(Function),
    );
  });

  it('handleMessage forwards a valid frame to the shared ingest core', async () => {
    await sub.handleMessage(
      JSON.stringify({ deliveryId: 'd1', droneId: 'x', phase: 'PICKUP' }),
    );
    expect(telemetry.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'd1', phase: 'PICKUP' }),
    );
  });

  it('drops a malformed frame without calling ingest', async () => {
    await sub.handleMessage('{ not json');
    expect(telemetry.ingest).not.toHaveBeenCalled();
  });

  it('swallows an ingest rejection (never throws into the broker loop)', async () => {
    telemetry.ingest.mockRejectedValueOnce(new Error('bound to another drone'));
    await expect(
      sub.handleMessage(JSON.stringify({ deliveryId: 'd1', droneId: 'x' })),
    ).resolves.toBeUndefined();
  });
});
