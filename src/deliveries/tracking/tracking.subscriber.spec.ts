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
