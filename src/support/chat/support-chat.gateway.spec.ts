import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SupportChatGateway } from './support-chat.gateway';

const req = (url: string) => ({ url, headers: { host: 'localhost' } }) as any;

describe('SupportChatGateway', () => {
  let gateway: SupportChatGateway;
  let jwt: { verifyAsync: jest.Mock };
  let chat: { assertOwnedTicket: jest.Mock; createUserMessage: jest.Mock };
  let publisher: { publishMessage: jest.Mock };
  let subscriber: {
    onUpdate: jest.Mock;
    subscribeToTicket: jest.Mock;
    unsubscribeFromTicket: jest.Mock;
  };
  let metrics: { wsSupportConnections: { inc: jest.Mock; dec: jest.Mock } };

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    chat = { assertOwnedTicket: jest.fn(), createUserMessage: jest.fn() };
    publisher = { publishMessage: jest.fn().mockResolvedValue(undefined) };
    subscriber = {
      onUpdate: jest.fn(),
      subscribeToTicket: jest.fn(),
      unsubscribeFromTicket: jest.fn(),
    };
    metrics = { wsSupportConnections: { inc: jest.fn(), dec: jest.fn() } };
    gateway = new SupportChatGateway(
      jwt as any,
      { get: jest.fn().mockReturnValue('secret') } as any,
      chat as any,
      publisher as any,
      subscriber as any,
      metrics as any,
    );
  });

  const socket = () => ({ close: jest.fn(), send: jest.fn(), readyState: 1 }) as any;

  describe('handleConnection (auth)', () => {
    it('accepts a valid token: sets userId, counts the connection', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      const client = socket();
      await gateway.handleConnection(client, req('/ws/support?token=good'));
      expect(client.userId).toBe('u-1');
      expect(metrics.wsSupportConnections.inc).toHaveBeenCalled();
      expect(client.close).not.toHaveBeenCalled();
    });

    it('rejects a missing token with close(1008)', async () => {
      const client = socket();
      await gateway.handleConnection(client, req('/ws/support'));
      expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
      expect(client.userId).toBeUndefined();
    });

    it('does NOT count a client that disconnected during verification', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u-1' });
      const client = socket();
      client.readyState = 3; // CLOSED before verify resolved
      await gateway.handleConnection(client, req('/ws/support?token=good'));
      expect(metrics.wsSupportConnections.inc).not.toHaveBeenCalled();
      expect(client.userId).toBeUndefined();
    });
  });

  describe('handleSubscribe (ownership)', () => {
    it('subscribes when the user owns the ticket + starts the Redis subscription', async () => {
      chat.assertOwnedTicket.mockResolvedValue({ id: 't-1' });
      const client = socket();
      client.userId = 'u-1';
      const res = await gateway.handleSubscribe(client, { ticketId: 't-1' });
      expect(chat.assertOwnedTicket).toHaveBeenCalledWith('u-1', 't-1');
      expect(res).toEqual({ event: 'subscribed', data: { ticketId: 't-1' } });
      expect(subscriber.subscribeToTicket).toHaveBeenCalledWith('t-1');
    });

    it('only opens ONE Redis subscription for multiple local subscribers', async () => {
      chat.assertOwnedTicket.mockResolvedValue({ id: 't-1' });
      const a = socket();
      a.userId = 'u-1';
      const b = socket();
      b.userId = 'u-1';
      await gateway.handleSubscribe(a, { ticketId: 't-1' });
      await gateway.handleSubscribe(b, { ticketId: 't-1' });
      expect(subscriber.subscribeToTicket).toHaveBeenCalledTimes(1);
    });

    it('rejects when the user does NOT own the ticket (no info leak)', async () => {
      chat.assertOwnedTicket.mockRejectedValue(new NotFoundException());
      const client = socket();
      client.userId = 'u-2';
      const res = await gateway.handleSubscribe(client, { ticketId: 't-1' });
      expect(res.event).toBe('error');
      expect(res.data.message).toBe('not found or no access');
      expect(subscriber.subscribeToTicket).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated socket', async () => {
      const res = await gateway.handleSubscribe(socket(), { ticketId: 't-1' });
      expect(res.event).toBe('error');
      expect(chat.assertOwnedTicket).not.toHaveBeenCalled();
    });
  });

  describe('handleSend', () => {
    it('persists, publishes, and acks the sender with the message payload', async () => {
      chat.createUserMessage.mockResolvedValue({
        id: 'm-1',
        ticketId: 't-1',
        senderRole: 'USER',
        senderUserId: 'u-1',
        content: 'hi',
        createdAt: new Date('2026-06-12T10:00:00.000Z'),
      });
      const client = socket();
      client.userId = 'u-1';
      const res = await gateway.handleSend(client, { ticketId: 't-1', content: '  hi  ' });
      expect(chat.createUserMessage).toHaveBeenCalledWith('u-1', 't-1', 'hi');
      expect(publisher.publishMessage).toHaveBeenCalledWith({
        id: 'm-1',
        ticketId: 't-1',
        senderRole: 'USER',
        senderUserId: 'u-1',
        content: 'hi',
        createdAt: '2026-06-12T10:00:00.000Z',
      });
      expect(res.event).toBe('message:sent');
      expect(res.data.id).toBe('m-1');
    });

    it('rejects empty content without touching the DB', async () => {
      const client = socket();
      client.userId = 'u-1';
      const res = await gateway.handleSend(client, { ticketId: 't-1', content: '   ' });
      expect(res).toEqual({ event: 'error', data: { message: 'bad request' } });
      expect(chat.createUserMessage).not.toHaveBeenCalled();
      expect(publisher.publishMessage).not.toHaveBeenCalled();
    });

    it('maps a CLOSED ticket to a "ticket closed" error and does not publish', async () => {
      chat.createUserMessage.mockRejectedValue(new BadRequestException());
      const client = socket();
      client.userId = 'u-1';
      const res = await gateway.handleSend(client, { ticketId: 't-1', content: 'hi' });
      expect(res).toEqual({ event: 'error', data: { message: 'ticket closed' } });
      expect(publisher.publishMessage).not.toHaveBeenCalled();
    });

    it('maps a non-owned ticket to a generic error', async () => {
      chat.createUserMessage.mockRejectedValue(new NotFoundException());
      const client = socket();
      client.userId = 'u-9';
      const res = await gateway.handleSend(client, { ticketId: 't-1', content: 'hi' });
      expect(res).toEqual({ event: 'error', data: { message: 'not found or no access' } });
    });
  });

  describe('deliverToLocalClients', () => {
    it('sends the Redis frame to subscribed OPEN clients only', async () => {
      chat.assertOwnedTicket.mockResolvedValue({ id: 't-1' });
      const open = socket();
      open.userId = 'u-1';
      const closed = socket();
      closed.userId = 'u-1';
      closed.readyState = 3;
      await gateway.handleSubscribe(open, { ticketId: 't-1' });
      await gateway.handleSubscribe(closed, { ticketId: 't-1' });

      const frame = { event: 'message:new', data: { id: 'm-1', ticketId: 't-1' } };
      gateway.deliverToLocalClients('t-1', frame);

      expect(open.send).toHaveBeenCalledWith(JSON.stringify(frame));
      expect(closed.send).not.toHaveBeenCalled();
    });

    it('is a no-op when nobody is subscribed', () => {
      expect(() =>
        gateway.deliverToLocalClients('nobody', { event: 'message:new', data: {} }),
      ).not.toThrow();
    });
  });

  describe('handleDisconnect', () => {
    it('drops the subscription, unsubscribes Redis, and decrements the gauge', async () => {
      chat.assertOwnedTicket.mockResolvedValue({ id: 't-1' });
      const client = socket();
      client.userId = 'u-1';
      await gateway.handleSubscribe(client, { ticketId: 't-1' });
      gateway.handleDisconnect(client);
      expect(subscriber.unsubscribeFromTicket).toHaveBeenCalledWith('t-1');
      expect(metrics.wsSupportConnections.dec).toHaveBeenCalled();
    });
  });
});
