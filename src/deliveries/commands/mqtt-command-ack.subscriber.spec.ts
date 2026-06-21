import { MqttCommandAckSubscriber } from './mqtt-command-ack.subscriber';
import { MetricsService } from '../../metrics/metrics.service';
import { MqttService } from '../../mqtt/mqtt.service';
import { DroneCommandService } from './drone-command.service';

describe('MqttCommandAckSubscriber', () => {
  let commands: { ack: jest.Mock };
  let mqtt: { subscribe: jest.Mock };
  let metrics: { mqttFramesTotal: { inc: jest.Mock } };
  let sub: MqttCommandAckSubscriber;

  beforeEach(() => {
    commands = { ack: jest.fn().mockResolvedValue({}) };
    mqtt = { subscribe: jest.fn() };
    metrics = { mqttFramesTotal: { inc: jest.fn() } };
    sub = new MqttCommandAckSubscriber(
      mqtt as unknown as MqttService,
      commands as unknown as DroneCommandService,
      metrics as unknown as MetricsService,
    );
  });

  it('subscribes to the ack filter on init', () => {
    sub.onModuleInit();
    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'drovery/commands/ack',
      expect.any(Function),
    );
  });

  it('drives ack() from a valid frame (accepted defaults true) + counts ok', async () => {
    await sub.handleAck(JSON.stringify({ commandId: 'c1', droneId: 'x' }));
    expect(commands.ack).toHaveBeenCalledWith('c1', 'x', true, undefined);
    expect(metrics.mqttFramesTotal.inc).toHaveBeenCalledWith({
      flow: 'command_ack',
      result: 'ok',
    });
  });

  it('passes accepted=false + a (clamped) note through', async () => {
    await sub.handleAck(
      JSON.stringify({
        commandId: 'c1',
        droneId: 'x',
        accepted: false,
        note: 'refused',
      }),
    );
    expect(commands.ack).toHaveBeenCalledWith('c1', 'x', false, 'refused');
  });

  it('drops a frame missing commandId/droneId', async () => {
    await sub.handleAck(JSON.stringify({ droneId: 'x' }));
    expect(commands.ack).not.toHaveBeenCalled();
  });

  it('drops malformed JSON', async () => {
    await sub.handleAck('not-json');
    expect(commands.ack).not.toHaveBeenCalled();
  });

  it('swallows an ack rejection (a duplicate/raced single-winner ack)', async () => {
    commands.ack.mockRejectedValueOnce(new Error('not awaiting ack'));
    await expect(
      sub.handleAck(JSON.stringify({ commandId: 'c1', droneId: 'x' })),
    ).resolves.toBeUndefined();
  });
});
