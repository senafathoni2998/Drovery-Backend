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
    expect(() => subscriber.dispatch('delivery:x:update', '{bad')).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
