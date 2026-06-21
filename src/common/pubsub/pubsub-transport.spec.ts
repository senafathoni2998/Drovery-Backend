import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import {
  pubSubMessageEvent,
  pubSubPublish,
  pubSubSubscribe,
  pubSubUnsubscribe,
  resolvePubSubMode,
} from './pubsub-transport';

describe('pubsub-transport', () => {
  const makeClient = () =>
    ({
      publish: jest.fn().mockResolvedValue(1),
      spublish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      ssubscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      sunsubscribe: jest.fn().mockResolvedValue(1),
    }) as unknown as Redis & Record<string, jest.Mock>;

  const cfg = (value?: string) =>
    ({ get: jest.fn().mockReturnValue(value) }) as unknown as ConfigService;

  describe('resolvePubSubMode', () => {
    it("returns 'sharded' only for the exact string 'sharded'", () => {
      expect(resolvePubSubMode(cfg('sharded'))).toBe('sharded');
    });

    it.each([undefined, '', 'standard', 'SHARDED', 'shard', 'true'])(
      'fails safe to standard for %p',
      (value) => {
        expect(resolvePubSubMode(cfg(value))).toBe('standard');
      },
    );
  });

  describe('pubSubMessageEvent', () => {
    it('maps sharded → smessage and standard → message', () => {
      expect(pubSubMessageEvent('sharded')).toBe('smessage');
      expect(pubSubMessageEvent('standard')).toBe('message');
    });
  });

  describe('standard mode routes to the classic commands', () => {
    it('publish/subscribe/unsubscribe call the non-sharded methods', async () => {
      const c = makeClient();
      await pubSubPublish(c, 'ch', 'msg', 'standard');
      await pubSubSubscribe(c, 'ch', 'standard');
      await pubSubUnsubscribe(c, 'ch', 'standard');

      expect(c.publish).toHaveBeenCalledWith('ch', 'msg');
      expect(c.subscribe).toHaveBeenCalledWith('ch');
      expect(c.unsubscribe).toHaveBeenCalledWith('ch');
      expect(c.spublish).not.toHaveBeenCalled();
      expect(c.ssubscribe).not.toHaveBeenCalled();
      expect(c.sunsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('sharded mode routes to the S-commands', () => {
    it('publish/subscribe/unsubscribe call the sharded methods', async () => {
      const c = makeClient();
      await pubSubPublish(c, 'ch', 'msg', 'sharded');
      await pubSubSubscribe(c, 'ch', 'sharded');
      await pubSubUnsubscribe(c, 'ch', 'sharded');

      expect(c.spublish).toHaveBeenCalledWith('ch', 'msg');
      expect(c.ssubscribe).toHaveBeenCalledWith('ch');
      expect(c.sunsubscribe).toHaveBeenCalledWith('ch');
      expect(c.publish).not.toHaveBeenCalled();
      expect(c.subscribe).not.toHaveBeenCalled();
      expect(c.unsubscribe).not.toHaveBeenCalled();
    });
  });
});
