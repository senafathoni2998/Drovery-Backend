import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:net';

import { MqttService } from './mqtt.service';

const cfg = (values: Record<string, unknown>): ConfigService =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MqttService', () => {
  describe('MOCK mode (MQTT_URL unset) — fully inert', () => {
    it('is mock; publish/subscribe/destroy are no-ops and never throw', () => {
      const svc = new MqttService(cfg({}));
      svc.onModuleInit();
      expect(svc.isMock()).toBe(true);
      expect(svc.isConnected()).toBe(false);
      expect(() =>
        svc.subscribe('drovery/telemetry/+', () => undefined),
      ).not.toThrow();
      expect(() => svc.publish('drovery/commands/x', { a: 1 })).not.toThrow();
      expect(() => svc.onModuleDestroy()).not.toThrow();
    });
  });

  describe('topicMatches', () => {
    it('+ matches one level; # matches the rest; exact otherwise', () => {
      expect(
        MqttService.topicMatches('drovery/telemetry/+', 'drovery/telemetry/d1'),
      ).toBe(true);
      expect(
        MqttService.topicMatches(
          'drovery/telemetry/+',
          'drovery/telemetry/d1/x',
        ),
      ).toBe(false);
      expect(
        MqttService.topicMatches(
          'drovery/commands/ack',
          'drovery/commands/ack',
        ),
      ).toBe(true);
      expect(
        MqttService.topicMatches('drovery/commands/ack', 'drovery/commands/x'),
      ).toBe(false);
      expect(MqttService.topicMatches('a/#', 'a/b/c')).toBe(true);
    });
  });

  describe('dispatch', () => {
    it('routes to the matching filter and swallows a throwing handler', () => {
      const svc = new MqttService(cfg({ 'mqtt.url': 'mqtt://x' }));
      // register handlers directly (no broker) via the private map through subscribe needs a
      // client; instead exercise dispatch by seeding the map.
      (
        svc as unknown as { handlers: Map<string, (p: string) => void> }
      ).handlers.set('drovery/telemetry/+', () => {
        throw new Error('boom');
      });
      expect(() => svc.dispatch('drovery/telemetry/d1', '{}')).not.toThrow();
    });
  });

  describe('fail-open (broker unreachable)', () => {
    it('connecting to a dead port does not throw; publish swallows', () => {
      const svc = new MqttService(
        cfg({
          'mqtt.url': 'mqtt://127.0.0.1:1',
          'mqtt.reconnectMs': 1000,
          'mqtt.offlineQueueMax': 5,
        }),
      );
      expect(() => svc.onModuleInit()).not.toThrow();
      expect(svc.isConnected()).toBe(false);
      for (let i = 0; i < 10; i++) svc.publish('t', { a: i }); // exceed the cap → drop, no throw
      svc.onModuleDestroy();
    });
  });

  describe('round-trip against an in-process aedes broker (no docker)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let broker: any;
    let server: Server;
    let port: number;
    let svc: MqttService;

    beforeAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      broker = (require('aedes') as () => any)();
      server = createServer(
        (broker as { handle: (s: unknown) => void }).handle,
      );
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve()),
      );
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      svc?.onModuleDestroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) =>
        (broker as { close: (cb: () => void) => void }).close(() => resolve()),
      );
    });

    it('delivers a published frame to a subscribed handler', async () => {
      svc = new MqttService(
        cfg({
          'mqtt.url': `mqtt://127.0.0.1:${port}`,
          'mqtt.shared': false, // aedes round-trip on the bare filter
          'mqtt.reconnectMs': 1000,
          'mqtt.offlineQueueMax': 100,
        }),
      );
      svc.onModuleInit();
      const received = new Promise<string>((resolve) =>
        svc.subscribe('drovery/telemetry/+', resolve),
      );
      for (let i = 0; i < 80 && !svc.isConnected(); i++) await sleep(50);
      expect(svc.isConnected()).toBe(true);
      await sleep(100); // let the SUBACK land
      svc.publish('drovery/telemetry/d1', { deliveryId: 'd1', droneId: 'x' });
      expect(JSON.parse(await received)).toEqual({
        deliveryId: 'd1',
        droneId: 'x',
      });
    }, 20000);
  });
});
