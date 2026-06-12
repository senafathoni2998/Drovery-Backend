import { TrackingGateway } from './tracking.gateway';

const req = (url: string) => ({ url, headers: { host: 'localhost' } }) as any;

describe('TrackingGateway', () => {
  let gateway: TrackingGateway;
  let jwt: { verifyAsync: jest.Mock };
  let deliveries: { findOne: jest.Mock };
  let subscriber: {
    onUpdate: jest.Mock;
    subscribeToDelivery: jest.Mock;
    unsubscribeFromDelivery: jest.Mock;
  };
  let metrics: { wsConnections: { inc: jest.Mock; dec: jest.Mock } };

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    deliveries = { findOne: jest.fn() };
    subscriber = {
      onUpdate: jest.fn(),
      subscribeToDelivery: jest.fn(),
      unsubscribeFromDelivery: jest.fn(),
    };
    metrics = { wsConnections: { inc: jest.fn(), dec: jest.fn() } };
    gateway = new TrackingGateway(
      jwt as any,
      { get: jest.fn().mockReturnValue('secret') } as any,
      deliveries as any,
      subscriber as any,
      metrics as any,
    );
  });

  const socket = () => ({ close: jest.fn(), send: jest.fn(), readyState: 1 }) as any;

  describe('handleConnection (auth)', () => {
    it('accepts a valid token: sets userId, counts the connection', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      const client = socket();
      await gateway.handleConnection(client, req('/?token=good'));
      expect(client.userId).toBe('u-1');
      expect(metrics.wsConnections.inc).toHaveBeenCalled();
      expect(client.close).not.toHaveBeenCalled();
    });

    it('rejects a missing token with close(1008)', async () => {
      const client = socket();
      await gateway.handleConnection(client, req('/'));
      expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
      expect(client.userId).toBeUndefined();
    });

    it('rejects an invalid token with close(1008)', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad sig'));
      const client = socket();
      await gateway.handleConnection(client, req('/?token=bad'));
      expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
    });

    it('does NOT count a client that disconnected during verification (no gauge leak)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      const client = socket();
      client.readyState = 3; // CLOSED before verify resolved
      await gateway.handleConnection(client, req('/?token=good'));
      expect(metrics.wsConnections.inc).not.toHaveBeenCalled();
      expect(client.userId).toBeUndefined();
    });
  });

  describe('handleSubscribe (ownership)', () => {
    it('subscribes when the user owns the delivery + starts the Redis subscription', async () => {
      deliveries.findOne.mockResolvedValue({ id: 'd-1' });
      const client = socket();
      client.userId = 'u-1';
      const res = await gateway.handleSubscribe(client, { deliveryId: 'd-1' });
      expect(deliveries.findOne).toHaveBeenCalledWith('u-1', 'd-1');
      expect(res).toEqual({ event: 'subscribed', data: { deliveryId: 'd-1' } });
      expect(subscriber.subscribeToDelivery).toHaveBeenCalledWith('d-1');
    });

    it('rejects when the user does NOT own the delivery (no info leak)', async () => {
      deliveries.findOne.mockRejectedValue(new Error('not found'));
      const client = socket();
      client.userId = 'u-2';
      const res = await gateway.handleSubscribe(client, { deliveryId: 'd-1' });
      expect(res.event).toBe('error');
      expect(subscriber.subscribeToDelivery).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated socket', async () => {
      const res = await gateway.handleSubscribe(socket(), { deliveryId: 'd-1' });
      expect(res.event).toBe('error');
      expect(deliveries.findOne).not.toHaveBeenCalled();
    });
  });

  describe('deliverToLocalClients', () => {
    it('sends a tracking:update frame to subscribed OPEN clients only', async () => {
      deliveries.findOne.mockResolvedValue({ id: 'd-1' });
      const open = socket();
      open.userId = 'u-1';
      const closed = socket();
      closed.userId = 'u-1';
      closed.readyState = 3; // CLOSED
      await gateway.handleSubscribe(open, { deliveryId: 'd-1' });
      await gateway.handleSubscribe(closed, { deliveryId: 'd-1' });

      gateway.deliverToLocalClients('d-1', { deliveryId: 'd-1', droneLat: 9 });

      expect(open.send).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'tracking:update',
          data: { deliveryId: 'd-1', droneLat: 9 },
        }),
      );
      expect(closed.send).not.toHaveBeenCalled();
    });

    it('is a no-op when nobody is subscribed', () => {
      expect(() =>
        gateway.deliverToLocalClients('nobody', { deliveryId: 'nobody' }),
      ).not.toThrow();
    });
  });
});
