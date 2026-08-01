import { EventEmitter } from 'events';

import { TrackingSubscriber } from './tracking.subscriber';
import { trackingChannel } from './tracking.publisher';

describe('TrackingSubscriber', () => {
  let subscriber: TrackingSubscriber;
  let sub: { subscribe: jest.Mock; unsubscribe: jest.Mock };

  beforeEach(() => {
    subscriber = new TrackingSubscriber({ get: jest.fn() } as any);
    sub = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    };
    (subscriber as any).sub = sub;
  });

  it('subscribes/unsubscribes to the per-delivery channel', () => {
    subscriber.subscribeToDelivery('d-1');
    expect(sub.subscribe).toHaveBeenCalledWith(trackingChannel('d-1'));
    subscriber.unsubscribeFromDelivery('d-1');
    expect(sub.unsubscribe).toHaveBeenCalledWith(trackingChannel('d-1'));
  });

  describe('re-arm after a Redis blip', () => {
    // enableOfflineQueue:false means a SUBSCRIBE issued while Redis is unreachable
    // rejects immediately. The gateway has already answered `subscribed`, so without
    // a retry the client is told it is live while receiving nothing — for the life of
    // the socket, because the non-empty local map stops anything re-subscribing.
    it('keeps the channel in the desired set when the subscribe fails', async () => {
      sub.subscribe.mockRejectedValueOnce(new Error("Stream isn't writeable"));

      subscriber.subscribeToDelivery('d-1');
      await Promise.resolve();

      expect([...(subscriber as any).desired]).toContain(
        trackingChannel('d-1'),
      );
    });

    it('re-subscribes every desired channel when the connection is ready again', () => {
      subscriber.subscribeToDelivery('d-1');
      subscriber.subscribeToDelivery('d-2');
      sub.subscribe.mockClear();

      // The real method the 'ready' handler calls — not a reimplementation of it.
      subscriber.rearmAll();

      expect(sub.subscribe).toHaveBeenCalledWith(trackingChannel('d-1'));
      expect(sub.subscribe).toHaveBeenCalledWith(trackingChannel('d-2'));
    });

    it('drops a channel from the desired set on unsubscribe, so it is not re-armed', () => {
      subscriber.subscribeToDelivery('d-1');
      subscriber.unsubscribeFromDelivery('d-1');

      expect((subscriber as any).desired.size).toBe(0);
    });
  });

  it('routes through the sharded S-commands when mode is sharded', () => {
    (subscriber as any).mode = 'sharded';
    const ssub = {
      ssubscribe: jest.fn().mockResolvedValue(1),
      sunsubscribe: jest.fn().mockResolvedValue(1),
    };
    (subscriber as any).sub = ssub;

    subscriber.subscribeToDelivery('d-9');
    subscriber.unsubscribeFromDelivery('d-9');

    expect(ssub.ssubscribe).toHaveBeenCalledWith(trackingChannel('d-9'));
    expect(ssub.sunsubscribe).toHaveBeenCalledWith(trackingChannel('d-9'));
    expect(sub.subscribe).not.toHaveBeenCalled();
  });

  it('dispatch() parses the channel id + payload and forwards to the handler', () => {
    const handler = jest.fn();
    subscriber.onUpdate(handler);

    subscriber.dispatch(
      trackingChannel('abc-123'),
      JSON.stringify({ deliveryId: 'abc-123', droneLat: 5, droneLng: 6 }),
    );

    expect(handler).toHaveBeenCalledWith('abc-123', {
      deliveryId: 'abc-123',
      droneLat: 5,
      droneLng: 6,
    });
  });

  it('dispatch() swallows malformed JSON without throwing', () => {
    const handler = jest.fn();
    subscriber.onUpdate(handler);
    expect(() =>
      subscriber.dispatch('delivery:x:update', '{bad'),
    ).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  // The most load-bearing line of the sharded seam: the dispatch listener must be
  // wired on the event matching the mode ('message' classic / 'smessage' sharded).
  // Wiring the wrong one silently receives nothing in production.
  describe('wireMessageListener', () => {
    it('standard mode registers dispatch on "message" only', () => {
      const spy = jest
        .spyOn(subscriber, 'dispatch')
        .mockImplementation(() => undefined);
      const emitter = new EventEmitter();
      (subscriber as any).mode = 'standard';
      (subscriber as any).wireMessageListener(emitter);

      emitter.emit('smessage', trackingChannel('d-1'), '{}'); // wrong event — ignored
      expect(spy).not.toHaveBeenCalled();
      emitter.emit('message', trackingChannel('d-1'), '{}');
      expect(spy).toHaveBeenCalledWith(trackingChannel('d-1'), '{}');
    });

    it('sharded mode registers dispatch on "smessage" only', () => {
      const spy = jest
        .spyOn(subscriber, 'dispatch')
        .mockImplementation(() => undefined);
      const emitter = new EventEmitter();
      (subscriber as any).mode = 'sharded';
      (subscriber as any).wireMessageListener(emitter);

      emitter.emit('message', trackingChannel('d-1'), '{}'); // wrong event — ignored
      expect(spy).not.toHaveBeenCalled();
      emitter.emit('smessage', trackingChannel('d-1'), '{}');
      expect(spy).toHaveBeenCalledWith(trackingChannel('d-1'), '{}');
    });
  });
});
